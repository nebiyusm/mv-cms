import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { TopNav } from './ui/TopNav'
import { PageHeader } from './ui/PageHeader'
import { StatusDropdown } from './ui/StatusDropdown'

/* --------------------------------- types --------------------------------- */

type HkStatus = 'clean' | 'dirty' | 'out_of_order'

interface HkBed {
  bedId: string
  bedLabel: string
  roomId: string
  roomName: string
  roomType: string
  status: string
  housekeepingStatus: HkStatus
  occupied: boolean
}

interface PropertyRow {
  id: string
  code: string
  name: string
}

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

const NAV_LINKS = [
  { label: 'Calendar', path: '/' },
  { label: 'Housekeeping', path: '/housekeeping' },
  { label: 'Folios', path: '/folios' },
  { label: 'Reports', path: '/admin' },
  { label: 'Component Demo', path: '/demo' },
]

const STATUS_OPTIONS = ['Clean', 'Dirty', 'Out of order'] as const
const LABEL_TO_API: Record<string, HkStatus> = {
  Clean: 'clean',
  Dirty: 'dirty',
  'Out of order': 'out_of_order',
}
const API_TO_LABEL: Record<HkStatus, string> = {
  clean: 'Clean',
  dirty: 'Dirty',
  out_of_order: 'Out of order',
}

const STATUS_DOT: Record<HkStatus, string> = {
  clean: 'bg-success',
  dirty: 'bg-amber-500',
  out_of_order: 'bg-danger',
}

const STATUS_SELECT_STYLES: Record<string, string> = {
  Clean: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  Dirty: 'border-amber-300 bg-amber-50 text-amber-700',
  'Out of order': 'border-red-300 bg-red-50 text-red-700',
}

/** Faint red hatch behind out-of-order rows */
const OOO_HATCH: React.CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(239,68,68,0.07) 8px, rgba(239,68,68,0.07) 16px)',
}

/* -------------------------------- component ------------------------------- */

export function Housekeeping() {
  const navigate = useNavigate()
  const [properties, setProperties] = useState<PropertyRow[]>([])
  const [propertyCode, setPropertyCode] = useState('ADD')
  const [currency, setCurrency] = useState('USD')
  const [beds, setBeds] = useState<HkBed[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showNotice = useCallback((message: string) => {
    setNotice(message)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 4000)
  }, [])

  useEffect(() => {
    supabase
      .from('properties')
      .select('id, code, name')
      .order('code')
      .then(({ data }) => setProperties(data ?? []))
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/housekeeping/beds?propertyCode=${propertyCode}`)
      if (!res.ok) throw new Error(`status ${res.status}`)
      const body = (await res.json()) as { beds: HkBed[] }
      setBeds(body.beds)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [propertyCode])

  useEffect(() => {
    setStatus('loading')
    void load()
  }, [load])

  // Staff see each other's status changes without refreshing.
  useEffect(() => {
    const channel = supabase
      .channel('housekeeping-beds')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'beds' }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [load])

  async function changeStatus(bed: HkBed, nextLabel: string) {
    const next = LABEL_TO_API[nextLabel]
    const previous = bed.housekeepingStatus
    if (next === previous) return

    // optimistic update
    setBeds((prev) =>
      prev.map((b) => (b.bedId === bed.bedId ? { ...b, housekeepingStatus: next } : b)),
    )
    try {
      const res = await fetch(`${API_BASE}/api/housekeeping/beds/${bed.bedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ housekeepingStatus: next }),
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
    } catch {
      // roll back
      setBeds((prev) =>
        prev.map((b) =>
          b.bedId === bed.bedId ? { ...b, housekeepingStatus: previous } : b,
        ),
      )
      showNotice(`Couldn't update ${bed.roomName} · Bed ${bed.bedLabel} — please try again`)
    }
  }

  const rooms = useMemo(() => {
    const byRoom = new Map<string, HkBed[]>()
    for (const bed of beds) {
      const list = byRoom.get(bed.roomName) ?? []
      list.push(bed)
      byRoom.set(bed.roomName, list)
    }
    return [...byRoom.entries()]
  }, [beds])

  const property = properties.find((p) => p.code === propertyCode)

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
        activePath="/housekeeping"
        onNavigate={(path) => navigate(path)}
      />

      <main className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6">
        <PageHeader
          icon={<Sparkles className="h-5 w-5" />}
          title="Housekeeping"
          subtitle={property ? `${property.name} · ${beds.length} beds` : 'Loading…'}
          actions={
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
          }
        />

        {status === 'loading' && (
          <p className="py-10 text-center text-sm text-text-secondary">Loading beds…</p>
        )}
        {status === 'error' && (
          <p className="py-10 text-center text-sm text-danger">
            Failed to load beds — is the API server running?
          </p>
        )}

        {status === 'ready' &&
          rooms.map(([roomName, roomBeds]) => (
            <section key={roomName}>
              <h2 className="label-caps mb-2 font-semibold">
                {roomName}
                <span className="ml-2 normal-case tracking-normal">
                  · {roomBeds[0].roomType}
                </span>
              </h2>
              <div className="space-y-2">
                {roomBeds.map((bed) => {
                  const ooo = bed.housekeepingStatus === 'out_of_order'
                  return (
                    <div
                      key={bed.bedId}
                      style={ooo ? OOO_HATCH : undefined}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-card px-4 py-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[bed.housekeepingStatus]}`}
                        />
                        <div className="min-w-0">
                          <div className="truncate text-base font-semibold text-text-primary">
                            Bed {bed.bedLabel}
                          </div>
                          <div className="text-xs text-text-secondary">
                            {bed.occupied ? 'Occupied' : 'Free'}
                            {bed.status === 'maintenance' && ' · Maintenance'}
                          </div>
                        </div>
                      </div>
                      <StatusDropdown
                        options={[...STATUS_OPTIONS]}
                        value={API_TO_LABEL[bed.housekeepingStatus]}
                        onChange={(label) => void changeStatus(bed, label)}
                        ariaLabel={`Housekeeping status for ${roomName} bed ${bed.bedLabel}`}
                        valueStyles={STATUS_SELECT_STYLES}
                        size="lg"
                      />
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
      </main>

      {notice && (
        <div
          role="alert"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-danger px-4 py-2.5 text-sm font-medium text-white shadow-lg"
        >
          {notice}
        </div>
      )}
    </div>
  )
}
