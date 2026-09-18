import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BedDouble, Plus, Trash2 } from 'lucide-react'
import { TopNav } from './ui/TopNav'
import { PageHeader } from './ui/PageHeader'
import { ActionButton } from './ui/ActionButton'
import { DataTable, type DataTableColumn } from './ui/DataTable'

/* --------------------------------- types --------------------------------- */

interface AvailableBed {
  bedId: string
  bedLabel: string
  roomId: string
  roomName: string
  roomType: string
}

interface RoomingRow extends Record<string, unknown> {
  id: string
  fullName: string
  bedId: string
}

interface ConfirmedRow {
  guestName: string
  roomName: string
  bedLabel: string
}

const NAV_LINKS = [
  { label: 'Calendar', path: '/' },
  { label: 'Component Demo', path: '/demo' },
]

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

function toLocalISO(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

let nextRowId = 1
const newRow = (): RoomingRow => ({ id: `row-${nextRowId++}`, fullName: '', bedId: '' })

/* -------------------------------- component ------------------------------- */

export function GroupBookingForm() {
  const navigate = useNavigate()

  const today = new Date()
  const defaultCheckIn = toLocalISO(today)
  const defaultCheckOut = toLocalISO(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2))

  const [propertyCode, setPropertyCode] = useState<'ADD' | 'NBO'>('ADD')
  const [checkIn, setCheckIn] = useState(defaultCheckIn)
  const [checkOut, setCheckOut] = useState(defaultCheckOut)

  const [beds, setBeds] = useState<AvailableBed[] | null>(null)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [rows, setRows] = useState<RoomingRow[]>([newRow()])

  const [checking, setChecking] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<ConfirmedRow[] | null>(null)

  const queryKey = `${propertyCode}|${checkIn}|${checkOut}`
  const datesValid = checkOut > checkIn
  const availabilityFresh = beds !== null && loadedKey === queryKey

  const takenBedIds = useMemo(
    () => new Set(rows.map((r) => r.bedId).filter(Boolean)),
    [rows],
  )
  const bedsById = useMemo(() => new Map((beds ?? []).map((b) => [b.bedId, b])), [beds])

  const rooms = useMemo(() => {
    const byRoom = new Map<string, AvailableBed[]>()
    for (const bed of beds ?? []) {
      const list = byRoom.get(bed.roomName) ?? []
      list.push(bed)
      byRoom.set(bed.roomName, list)
    }
    return [...byRoom.entries()]
  }, [beds])

  const rowsValid =
    rows.length > 0 &&
    rows.every((r) => r.fullName.trim().length > 0 && r.bedId.length > 0) &&
    takenBedIds.size === rows.length

  const canSubmit = availabilityFresh && rowsValid && !submitting
  const canAddRow = availabilityFresh && rows.length < (beds?.length ?? 0)

  async function checkAvailability() {
    setChecking(true)
    setConflict(false)
    setErrorMessage(null)
    try {
      const params = new URLSearchParams({ propertyCode, checkIn, checkOut })
      const res = await fetch(`${API_BASE}/api/availability?${params}`)
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.issues?.[0]?.message ?? `Availability check failed (${res.status})`)
      }
      const body = (await res.json()) as { beds: AvailableBed[] }
      const freshIds = new Set(body.beds.map((b) => b.bedId))
      setBeds(body.beds)
      setLoadedKey(queryKey)
      // Keep selections that are still available; drop the rest.
      setRows((prev) => prev.map((r) => (r.bedId && !freshIds.has(r.bedId) ? { ...r, bedId: '' } : r)))
    } catch (err) {
      setBeds(null)
      setLoadedKey(null)
      setErrorMessage(err instanceof Error ? err.message : 'Availability check failed')
    } finally {
      setChecking(false)
    }
  }

  function updateRow(id: string, patch: Partial<RoomingRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function removeRow(id: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev))
  }

  async function submit() {
    setSubmitting(true)
    setConflict(false)
    setErrorMessage(null)
    try {
      const res = await fetch(`${API_BASE}/api/bookings/group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyCode,
          checkIn,
          checkOut,
          source: 'walk_in',
          entries: rows.map((r) => ({
            guest: { fullName: r.fullName.trim() },
            bedId: r.bedId,
          })),
        }),
      })
      if (res.status === 409) {
        setConflict(true)
        return
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.issues?.[0]?.message ?? `Booking failed (${res.status})`)
      }
      setConfirmed(
        rows.map((r) => {
          const bed = bedsById.get(r.bedId)
          return {
            guestName: r.fullName.trim(),
            roomName: bed?.roomName ?? '',
            bedLabel: bed?.bedLabel ?? '',
          }
        }),
      )
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Booking failed')
    } finally {
      setSubmitting(false)
    }
  }

  const columns: DataTableColumn<RoomingRow>[] = [
    { key: 'index', header: '#', render: (_row, i) => i + 1 },
    {
      key: 'fullName',
      header: 'Guest full name',
      render: (row) => (
        <input
          type="text"
          value={row.fullName}
          onChange={(e) => updateRow(row.id, { fullName: e.target.value })}
          placeholder="e.g. Jane Doe"
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      ),
    },
    {
      key: 'bedId',
      header: 'Bed',
      render: (row) => (
        <select
          value={row.bedId}
          onChange={(e) => updateRow(row.id, { bedId: e.target.value })}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">Select a bed…</option>
          {rooms.map(([roomName, roomBeds]) => (
            <optgroup key={roomName} label={roomName}>
              {roomBeds.map((bed) => (
                <option
                  key={bed.bedId}
                  value={bed.bedId}
                  disabled={takenBedIds.has(bed.bedId) && row.bedId !== bed.bedId}
                >
                  Bed {bed.bedLabel}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <button
          onClick={() => removeRow(row.id)}
          disabled={rows.length <= 1}
          aria-label="Remove guest"
          className="rounded-md p-1.5 text-text-secondary hover:bg-red-50 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ),
    },
  ]

  return (
    <div className="min-h-screen bg-bg-page">
      <TopNav
        properties={['ADD', 'NBO']}
        selectedProperty={propertyCode}
        onPropertyChange={(code) => setPropertyCode(code as 'ADD' | 'NBO')}
        currencies={['USD', 'ETB', 'KES']}
        selectedCurrency="USD"
        onCurrencyChange={() => undefined}
        links={NAV_LINKS}
        activePath="/new-booking"
        onNavigate={(path) => navigate(path)}
      />

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          icon={<BedDouble className="h-5 w-5" />}
          title="New Booking"
          subtitle="Walk-in or group booking — check availability, then assign each guest to a bed."
        />

        {confirmed ? (
          <div className="rounded-lg border border-border bg-bg-card p-6">
            <h2 className="text-lg font-semibold text-text-primary">Booking confirmed</h2>
            <p className="mt-1 text-sm text-text-secondary">
              {confirmed.length} {confirmed.length === 1 ? 'guest' : 'guests'} booked · {checkIn} → {checkOut}
            </p>
            <ul className="mt-4 space-y-2">
              {confirmed.map((row, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between rounded-md border border-border bg-slate-50 px-4 py-2.5 text-sm"
                >
                  <span className="font-medium text-text-primary">{row.guestName}</span>
                  <span className="text-text-secondary">
                    {row.roomName} · Bed {row.bedLabel}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-6">
              <Link to="/" className="text-sm font-medium text-primary hover:underline">
                ← Back to calendar
              </Link>
            </div>
          </div>
        ) : (
          <>
            {conflict && (
              <div
                role="alert"
                className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-danger"
              >
                One or more beds just became unavailable — re-check availability and adjust the rooming list.
              </div>
            )}
            {errorMessage && (
              <div
                role="alert"
                className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-danger"
              >
                {errorMessage}
              </div>
            )}

            {/* Stay details */}
            <div className="rounded-lg border border-border bg-bg-card p-6">
              <h2 className="text-sm font-semibold text-text-primary">Stay details</h2>
              <div className="mt-4 flex flex-wrap items-end gap-4">
                <div>
                  <label className="label-caps mb-1 block">Property</label>
                  <div className="flex overflow-hidden rounded-md border border-gray-300 bg-white text-sm">
                    {(['ADD', 'NBO'] as const).map((code) => (
                      <button
                        key={code}
                        onClick={() => setPropertyCode(code)}
                        className={`px-3 py-1.5 font-medium transition-colors ${
                          code === propertyCode
                            ? 'bg-primary text-white'
                            : 'text-text-primary hover:bg-slate-100'
                        }`}
                      >
                        {code}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label htmlFor="check-in" className="label-caps mb-1 block">
                    Check-in
                  </label>
                  <input
                    id="check-in"
                    type="date"
                    value={checkIn}
                    onChange={(e) => setCheckIn(e.target.value)}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label htmlFor="check-out" className="label-caps mb-1 block">
                    Check-out
                  </label>
                  <input
                    id="check-out"
                    type="date"
                    value={checkOut}
                    onChange={(e) => setCheckOut(e.target.value)}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <ActionButton onClick={checkAvailability} disabled={!datesValid || checking}>
                  {checking ? 'Checking…' : 'Check availability'}
                </ActionButton>
              </div>
              {!datesValid && (
                <p className="mt-2 text-sm text-danger">Check-out must be after check-in.</p>
              )}
            </div>

            {/* Rooming list */}
            <div className="rounded-lg border border-border bg-bg-card p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text-primary">Rooming list</h2>
                <button
                  onClick={() => setRows((prev) => [...prev, newRow()])}
                  disabled={!canAddRow}
                  className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  Add guest
                </button>
              </div>

              <div className="mt-4">
                {beds === null ? (
                  <p className="py-6 text-center text-sm text-text-secondary">
                    Check availability above to load free beds for this stay.
                  </p>
                ) : beds.length === 0 ? (
                  <p className="py-6 text-center text-sm text-text-secondary">
                    No beds are free for {checkIn} → {checkOut} at {propertyCode}.
                  </p>
                ) : (
                  <>
                    {!availabilityFresh && (
                      <p className="mb-3 text-sm font-medium text-amber-600">
                        Dates or property changed — re-check availability before submitting.
                      </p>
                    )}
                    <DataTable
                      columns={columns}
                      rows={rows}
                      rowKey={(row) => row.id}
                      emptyMessage="No guests yet — add one above."
                    />
                    <div className="mt-4 flex items-center justify-between">
                      <p className="text-sm text-text-secondary">
                        {rows.length} {rows.length === 1 ? 'guest' : 'guests'} · {beds.length} beds available
                      </p>
                      <ActionButton onClick={submit} disabled={!canSubmit}>
                        {submitting ? 'Creating booking…' : 'Create booking'}
                      </ActionButton>
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
