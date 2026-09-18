import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays } from 'lucide-react'
import { DataSet } from 'vis-data/standalone'
import { Timeline } from 'vis-timeline/standalone'
import type { DataGroup, DataItem, TimelineItem, TimelineOptions } from 'vis-timeline'
import 'vis-timeline/styles/vis-timeline-graph2d.min.css'
import { supabase } from '../lib/supabase'
import { SOURCE_COLORS, type Platform } from '../lib/sourceColors'
import { TopNav } from './ui/TopNav'
import { PageHeader } from './ui/PageHeader'
import { ActionButton } from './ui/ActionButton'

/* ------------------------------- row types ------------------------------- */

interface PropertyRow {
  id: string
  code: string
  name: string
}

interface RoomRow {
  id: string
  property_id: string
  name: string
  room_type: 'dorm' | 'private'
}

interface BedRow {
  id: string
  room_id: string
  label: string
  status: 'active' | 'maintenance'
}

interface BookingBedRow {
  id: string
  bed_id: string
  /** Postgres daterange literal, default [) bounds, e.g. "[2026-09-15,2026-09-18)" */
  stay: string
  is_active: boolean
  bookings: {
    id: string
    status: string
    source: string
    guests: { full_name: string } | null
  } | null
}

/** A blocked date range on a bed (maintenance, future bed_blocks rows, ...) */
interface BlockRange {
  bedId: string
  start: Date
  end: Date
  reason: string
}

interface BookingItemData extends DataItem {
  itemKind: 'booking'
  guestName: string
  platform: Platform
  sourceLabel: string
}

/** Parsed, active booking placement — the client-side overlap source of truth. */
interface BookingPlacement {
  id: string
  bedId: string
  start: Date
  end: Date
}

/* ------------------------------ data mapping ----------------------------- */

/** bookings.source (DB) -> UI-kit Platform */
const SOURCE_TO_PLATFORM: Record<string, Platform> = {
  booking_com: 'booking',
  hostelworld: 'hostelworld',
  direct: 'direct',
  walk_in: 'direct',
  phone: 'direct',
}

function toPlatform(source: string): Platform {
  return SOURCE_TO_PLATFORM[source] ?? 'direct'
}

/** Parse a Postgres daterange literal with [) bounds into JS dates (local midnight). */
function parseStay(stay: string): { start: Date; end: Date } | null {
  // PostgREST renders dateranges with quoted bounds, e.g. ["2026-09-15","2026-09-18")
  const m = stay.replace(/"/g, '').match(/^[[(]([^,]*),([^)\]]*)[\])]$/)
  if (!m) return null
  const [, lower, upper] = m
  if (!lower || !upper) return null
  return { start: new Date(`${lower}T00:00:00`), end: new Date(`${upper}T00:00:00`) }
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d)
  copy.setDate(copy.getDate() + days)
  return copy
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** vis-timeline label format functions receive a moment-like object, not a native Date. */
function asDate(raw: unknown): Date {
  if (raw instanceof Date) return raw
  return new Date((raw as { valueOf(): number }).valueOf())
}

/* ------------------------------ fetch layer ------------------------------ */

async function fetchProperties(): Promise<PropertyRow[]> {
  const { data, error } = await supabase.from('properties').select('id, code, name').order('code')
  if (error) throw error
  return (data ?? []) as PropertyRow[]
}

async function fetchRoomsAndBeds(propertyId: string): Promise<{ rooms: RoomRow[]; beds: BedRow[] }> {
  const { data: rooms, error: roomsError } = await supabase
    .from('rooms')
    .select('id, property_id, name, room_type')
    .eq('property_id', propertyId)
    .order('room_type') // 'dorm' sorts before 'private'
    .order('name')
  if (roomsError) throw roomsError

  const roomIds = (rooms ?? []).map((r: RoomRow) => r.id)
  if (roomIds.length === 0) return { rooms: [], beds: [] }

  const { data: beds, error: bedsError } = await supabase
    .from('beds')
    .select('id, room_id, label, status')
    .in('room_id', roomIds)
    .order('label')
  if (bedsError) throw bedsError

  return { rooms: (rooms ?? []) as RoomRow[], beds: (beds ?? []) as BedRow[] }
}

async function fetchBookingBeds(bedIds: string[]): Promise<BookingBedRow[]> {
  if (bedIds.length === 0) return []
  const { data, error } = await supabase
    .from('booking_beds')
    .select('id, bed_id, stay, is_active, bookings!inner(id, status, source, guests!inner(full_name))')
    .eq('is_active', true)
    .neq('bookings.status', 'cancelled')
    .in('bed_id', bedIds)
  if (error) throw error
  return (data ?? []) as unknown as BookingBedRow[]
}

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/** Persist a drag-and-drop reassignment. Returns an error message on failure. */
async function persistMove(
  bookingBedId: string,
  bedId: string,
  start: Date,
  end: Date,
): Promise<string | null> {
  const stay = `[${formatDate(start)},${formatDate(end)})`
  const { error } = await supabase
    .from('booking_beds')
    .update({ bed_id: bedId, stay })
    .eq('id', bookingBedId)
  return error ? error.message : null
}

/**
 * Blocked ranges for the timeline.
 *
 * EXTENSION POINT: today the only block source is `beds.status = 'maintenance'`
 * (the whole visible window is blocked for that bed). When a `bed_blocks`
 * table lands, fetch it here and merge its rows into the returned array —
 * the renderer below already works off generic BlockRange objects.
 */
async function fetchBlocks(beds: BedRow[], windowStart: Date, windowEnd: Date): Promise<BlockRange[]> {
  // const { data: bedBlocks } = await supabase.from('bed_blocks').select(...) // future
  return beds
    .filter((bed) => bed.status === 'maintenance')
    .map((bed) => ({ bedId: bed.id, start: windowStart, end: windowEnd, reason: 'maintenance' }))
}

/* --------------------------- item HTML templates -------------------------- */

const LOCK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'

/** Mirrors the markup/styles of the BookingPill UI-kit component. */
function bookingPillHtml(item: BookingItemData): string {
  const source = SOURCE_COLORS[item.platform]
  const name = escapeHtml(item.guestName)
  return (
    `<div class="mv-pill" title="${name} — ${escapeHtml(item.sourceLabel)}" ` +
    `style="background-color:${source.soft};color:${source.text};border-left:3px solid ${source.bg}">` +
    `<span class="mv-badge" style="background-color:${source.bg}">${source.letter}</span>` +
    `<span class="mv-pill-name">${name}</span>` +
    `</div>`
  )
}

/** Mirrors the BlockedCell UI-kit component (gray + diagonal hatch + lock). */
function blockedHtml(reason: string): string {
  return `<div class="mv-blocked-cell" title="Blocked — ${escapeHtml(reason)}">${LOCK_SVG}</div>`
}

/* -------------------------------- component ------------------------------- */

const NAV_LINKS = [
  { label: 'Calendar', path: '/' },
  { label: 'Housekeeping', path: '/housekeeping' },
  { label: 'Folios', path: '/folios' },
  { label: 'Reports', path: '/admin' },
  { label: 'Component Demo', path: '/demo' },
]

export function BedTimeline() {
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<Timeline | null>(null)

  const [properties, setProperties] = useState<PropertyRow[]>([])
  const [propertyCode, setPropertyCode] = useState<string>('ADD')
  const [currency, setCurrency] = useState('USD')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Latest fetched data, consulted by the drag-and-drop move handler.
  const bedsRef = useRef<BedRow[]>([])
  const placementsRef = useRef<BookingPlacement[]>([])

  const showNotice = useCallback((message: string) => {
    setNotice(message)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 4000)
  }, [])

  const now = new Date()
  const windowStart = startOfDay(addDays(now, -3))
  const windowEnd = startOfDay(addDays(now, +11)) // ~2 weeks visible
  const todayStart = startOfDay(now)
  const todayEnd = addDays(todayStart, 1)

  const load = useCallback(async () => {
    const timeline = timelineRef.current
    if (!timeline) return
    try {
      const property = properties.find((p) => p.code === propertyCode)
      if (!property) return

      const { rooms, beds } = await fetchRoomsAndBeds(property.id)
      const bedIds = beds.map((b) => b.id)
      const [bookingBeds, blocks] = await Promise.all([
        fetchBookingBeds(bedIds),
        fetchBlocks(beds, windowStart, windowEnd),
      ])
      bedsRef.current = beds

      // --- groups: room header rows with nested lettered bed sub-rows ---
      const groups: DataGroup[] = []
      for (const room of rooms) {
        const roomBeds = beds.filter((b) => b.room_id === room.id)
        if (roomBeds.length === 0) continue
        const bedGroupIds = roomBeds.map((b) => `bed:${b.id}`)
        groups.push({
          id: `room:${room.id}`,
          content:
            `<span class="mv-room-name">${escapeHtml(room.name)}</span>` +
            `<span class="mv-room-type">${room.room_type}</span>`,
          nestedGroups: bedGroupIds,
          className: 'mv-room-group',
        })
        for (const bed of roomBeds) {
          groups.push({
            id: `bed:${bed.id}`,
            content: room.room_type === 'dorm' ? `Bed ${escapeHtml(bed.label)}` : 'Room',
            className: 'mv-bed-group',
          })
        }
      }

      // --- items ---
      const items: DataItem[] = [
        // today's column highlight (blue-600 tint across all rows)
        {
          id: 'mv-today',
          type: 'background',
          start: todayStart,
          end: todayEnd,
          className: 'mv-today',
          content: '',
        },
      ]

      for (const block of blocks) {
        items.push({
          id: `block:${block.bedId}`,
          group: `bed:${block.bedId}`,
          type: 'background',
          start: block.start,
          end: block.end,
          className: 'mv-blocked',
          content: blockedHtml(block.reason),
        })
      }

      const placements: BookingPlacement[] = []
      for (const bb of bookingBeds) {
        const range = parseStay(bb.stay)
        if (!range || !bb.bookings) continue
        placements.push({ id: bb.id, bedId: bb.bed_id, start: range.start, end: range.end })
        const platform = toPlatform(bb.bookings.source)
        items.push({
          id: bb.id,
          group: `bed:${bb.bed_id}`,
          start: range.start,
          end: range.end,
          className: 'mv-booking',
          content: '',
          itemKind: 'booking',
          guestName: bb.bookings.guests?.full_name ?? 'Guest',
          platform,
          sourceLabel: SOURCE_COLORS[platform].label,
        } as BookingItemData)
      }
      placementsRef.current = placements

      timeline.setGroups(new DataSet(groups))
      timeline.setItems(new DataSet(items))
      setStatus('ready')
    } catch (err) {
      setStatus('error')
      setErrorMessage(err instanceof Error ? err.message : String(err))
    }
    // window/today bounds are fixed per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties, propertyCode])

  const loadRef = useRef(load)
  loadRef.current = load

  /* Create the timeline once */
  useEffect(() => {
    if (!containerRef.current) return

    /** Briefly flash a pill red to signal a rejected move. */
    const flashItem = (id: string) => {
      // itemsData exists at runtime but is not part of the public Timeline type
      const itemsData = () =>
        (timelineRef.current as unknown as { itemsData: DataSet<DataItem> } | null)?.itemsData
      itemsData()?.update({ id, className: 'mv-booking mv-rejected' } as DataItem)
      setTimeout(() => {
        itemsData()?.update({ id, className: 'mv-booking' } as DataItem)
      }, 900)
    }

    /**
     * Drag-and-drop validation + persistence.
     * Vertical move = reassign bed, horizontal move = change dates; both validated.
     * Reject (item snaps back) on: non-bed drop, past dates, maintenance bed,
     * overlap with another active booking on the target bed. The DB exclusion
     * constraint is the final guard — a failed UPDATE reverts via refetch.
     */
    const onMove = (item: TimelineItem, callback: (item: TimelineItem | null) => void) => {
      const data = item as unknown as BookingItemData
      if (data.itemKind !== 'booking') {
        callback(null)
        return
      }

      const bedId = typeof data.group === 'string' ? data.group.replace(/^bed:/, '') : ''
      const start = startOfDay(asDate(data.start))
      const end = startOfDay(asDate(data.end))

      const reject = (message: string) => {
        callback(null) // vis returns the item to its original position
        flashItem(String(data.id))
        showNotice(message)
      }

      const bed = bedsRef.current.find((b) => b.id === bedId)
      if (!bedId || !bed) return reject('Drop the booking onto a bed row')
      // Reject dragging a booking's start into the past; an unchanged range
      // that already spans today (e.g. a checked-in guest) may move beds.
      const original = placementsRef.current.find((p) => p.id === data.id)
      if (start.getTime() < todayStart.getTime() && start.getTime() !== original?.start.getTime())
        return reject("Can't move a booking into the past")
      if (bed.status === 'maintenance') return reject('Bed is under maintenance')

      const overlap = placementsRef.current.some(
        (p) => p.id !== data.id && p.bedId === bedId && start < p.end && p.start < end,
      )
      if (overlap) return reject('Bed occupied for those dates')

      // Optimistically apply, then persist; on DB failure (e.g. 23P01 race)
      // revert by refetching from the database.
      callback(item)
      void persistMove(String(data.id), bedId, start, end).then((error) => {
        if (error) {
          showNotice('Bed occupied for those dates')
          flashItem(String(data.id))
          void loadRef.current()
        }
      })
    }

    const options: TimelineOptions = {
      start: windowStart,
      end: windowEnd,
      min: addDays(windowStart, -60),
      max: addDays(windowEnd, 90),
      zoomMin: 1000 * 60 * 60 * 24 * 2, // 2 days
      zoomMax: 1000 * 60 * 60 * 24 * 60, // 60 days
      orientation: 'top',
      stack: true,
      showCurrentTime: true,
      // read-only otherwise: only moving existing bookings is allowed
      editable: { add: false, remove: false, updateTime: true, updateGroup: true },
      // drag without a click-to-select first
      itemsAlwaysDraggable: { item: true },
      snap: (date: Date) => startOfDay(asDate(date)),
      onMove,
      // Our item/label HTML is built in-house and user data is escapeHtml'd;
      // vis's default XSS filter would strip the class attributes we style with.
      xss: { disabled: true },
      horizontalScroll: false,
      verticalScroll: true,
      maxHeight: '70vh',
      margin: { item: { horizontal: 1, vertical: 4 }, axis: 6 },
      timeAxis: { scale: 'day', step: 1 },
      format: {
        // two-line header: day abbreviation + date number, today in blue-600
        // NOTE: vis-timeline passes a moment-like object, not a native Date.
        minorLabels: (raw: unknown) => {
          const date = asDate(raw)
          const isToday = startOfDay(date).getTime() === todayStart.getTime()
          const dow = date.toLocaleDateString('en-US', { weekday: 'short' })
          return (
            `<div class="mv-day-label${isToday ? ' mv-day-today' : ''}">` +
            `<span class="mv-day-dow">${dow}</span>` +
            `<span class="mv-day-num">${date.getDate()}</span>` +
            `</div>`
          )
        },
        majorLabels: (raw: unknown) => {
          const date = asDate(raw)
          return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        },
      },
      template: (item: DataItem) => {
        const data = item as BookingItemData
        if (data.itemKind === 'booking') return bookingPillHtml(data)
        return (item.content as string) ?? ''
      },
    }

    const timeline = new Timeline(containerRef.current, new DataSet(), new DataSet(), options)
    timelineRef.current = timeline

    // vis-timeline 8.x configures the item-drag pan recognizer with
    // `modifiedHammer.ALL`, a static that @egjs/hammerjs does not have (only
    // DIRECTION_ALL = 30 exists) — the recognizer's directionTest can never
    // pass and dragging silently dies. Patch the live recognizer here.
    const itemSet = (
      timeline as unknown as {
        itemSet?: { hammer?: { get(name: string): { set(opts: object): void } } }
      }
    ).itemSet
    itemSet?.hammer?.get('pan')?.set({ direction: 30 }) // Hammer.DIRECTION_ALL

    // dev-only handle for Playwright probes
    if (import.meta.env.DEV) {
      ;(window as unknown as { __timeline: Timeline }).__timeline = timeline
    }

    return () => {
      timeline.destroy()
      timelineRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* Load property list once */
  useEffect(() => {
    fetchProperties()
      .then(setProperties)
      .catch((err) => {
        setStatus('error')
        setErrorMessage(err instanceof Error ? err.message : String(err))
      })
  }, [])

  /* Fetch + render whenever properties/property changes */
  useEffect(() => {
    if (properties.length > 0) void load()
  }, [properties, load])

  /* Realtime: refetch on any change to booking_beds / bookings / beds */
  useEffect(() => {
    const channel = supabase
      .channel('bed-timeline')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'booking_beds' }, () =>
        loadRef.current(),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () =>
        loadRef.current(),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'beds' }, () =>
        loadRef.current(),
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [])

  const jumpToToday = () => {
    timelineRef.current?.setWindow(windowStart, windowEnd, { animation: true })
  }

  const property = properties.find((p) => p.code === propertyCode)
  const subtitle = property
    ? `${property.name} · ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}`
    : 'Loading…'

  return (
    <div className="min-h-screen bg-bg-page">
      <TopNav
        properties={properties.map((p) => p.name)}
        selectedProperty={property?.name ?? ''}
        onPropertyChange={(name) => {
          const next = properties.find((p) => p.name === name)
          if (next) setPropertyCode(next.code)
        }}
        currencies={['USD', 'ETB', 'KES']}
        selectedCurrency={currency}
        onCurrencyChange={setCurrency}
        links={NAV_LINKS}
        activePath="/"
        onNavigate={(path) => navigate(path)}
      />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          icon={<CalendarDays className="h-5 w-5" />}
          title="Calendar"
          subtitle={subtitle}
          actions={
            <>
              {/* Property selector (ADD / NBO) */}
              <div className="flex overflow-hidden rounded-md border border-gray-300 bg-white text-sm">
                {properties.map((p) => (
                  <button
                    key={p.code}
                    onClick={() => setPropertyCode(p.code)}
                    className={`px-3 py-1.5 font-medium transition-colors ${
                      p.code === propertyCode
                        ? 'bg-primary text-white'
                        : 'text-text-primary hover:bg-slate-100'
                    }`}
                  >
                    {p.code}
                  </button>
                ))}
              </div>
              <button
                onClick={jumpToToday}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-slate-100"
              >
                Today
              </button>
              <ActionButton onClick={() => navigate('/new-booking')}>New Booking</ActionButton>
            </>
          }
        />

        <div className="rounded-lg border border-border bg-bg-card p-4">
          {status === 'error' && (
            <p className="py-8 text-center text-sm text-danger">
              Failed to load timeline: {errorMessage}
            </p>
          )}
          {status === 'loading' && (
            <p className="py-8 text-center text-sm text-text-secondary">Loading beds…</p>
          )}
          <div ref={containerRef} className="mv-timeline" />
        </div>
      </main>

      {/* rejection feedback toast */}
      {notice && (
        <div
          role="alert"
          className="mv-toast fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-danger px-4 py-2.5 text-sm font-medium text-white shadow-lg"
        >
          {notice}
        </div>
      )}
    </div>
  )
}
