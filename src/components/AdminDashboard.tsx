import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart3 } from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { SOURCE_COLORS } from '../lib/sourceColors'
import { TopNav } from './ui/TopNav'
import { PageHeader } from './ui/PageHeader'
import { StatCard } from './ui/StatCard'
import { DataTable, type DataTableColumn } from './ui/DataTable'

/* --------------------------------- types --------------------------------- */

interface DailyRow extends Record<string, unknown> {
  date: string
  occupiedBedNights: number
  availableBedNights: number
  occupancyPct: number
  revenue: number
  adr: number
  revpar: number
}

interface StatsResponse {
  daily: DailyRow[]
  totals: {
    occupancyPct: number
    adr: number
    revpar: number
    revenue: number
    occupiedBedNights: number
    availableBedNights: number
  }
  channels: { source: string; bookings: number; revenue: number }[]
  today: { occupancyPct: number; arrivals: number; inHouse: number; checkoutsToday: number }
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

/** bookings.source -> fixed chart color (sourceColors palette; walk-in/phone
 *  get direct-ish emerald hues) */
const CHANNEL_COLORS: Record<string, string> = {
  booking_com: SOURCE_COLORS.booking.bg,
  hostelworld: SOURCE_COLORS.hostelworld.bg,
  direct: SOURCE_COLORS.direct.bg,
  walk_in: '#6EE7B7', // emerald-300
  phone: '#047857', // emerald-700
}

const CHANNEL_LABELS: Record<string, string> = {
  booking_com: 'Booking.com',
  hostelworld: 'Hostelworld',
  direct: 'Direct',
  walk_in: 'Walk-in',
  phone: 'Phone',
}

const RANGES = [
  { key: 'last7', label: 'Last 7 days', fromOffset: -7, toOffset: 0 },
  { key: 'last14', label: 'Last 14 days', fromOffset: -14, toOffset: 0 },
  { key: 'next14', label: 'Next 14 days', fromOffset: 0, toOffset: 14 },
] as const

function dayISO(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

const money = (n: number) => `$${n.toFixed(2)}`
const shortDay = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })

/* -------------------------------- component ------------------------------- */

export function AdminDashboard() {
  const navigate = useNavigate()
  const [properties, setProperties] = useState<PropertyRow[]>([])
  const [propertyCode, setPropertyCode] = useState('ADD')
  const [currency, setCurrency] = useState('USD')
  const [rangeKey, setRangeKey] = useState<(typeof RANGES)[number]['key']>('last14')
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    supabase
      .from('properties')
      .select('id, code, name')
      .order('code')
      .then(({ data }) => setProperties(data ?? []))
  }, [])

  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[1]

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const params = new URLSearchParams({
        propertyCode,
        from: dayISO(range.fromOffset),
        to: dayISO(range.toOffset),
      })
      const res = await fetch(`${API_BASE}/api/admin/stats?${params}`)
      if (!res.ok) throw new Error(`status ${res.status}`)
      setStats((await res.json()) as StatsResponse)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [propertyCode, range])

  useEffect(() => {
    void load()
  }, [load])

  const property = properties.find((p) => p.code === propertyCode)
  const bookingsInRange = useMemo(
    () => stats?.channels.reduce((sum, c) => sum + c.bookings, 0) ?? 0,
    [stats],
  )

  const dailyColumns: DataTableColumn<DailyRow>[] = [
    { key: 'date', header: 'Date' },
    {
      key: 'occupiedBedNights',
      header: 'Occupied / Available',
      render: (row) => `${row.occupiedBedNights} / ${row.availableBedNights}`,
    },
    { key: 'occupancyPct', header: 'Occupancy', render: (row) => `${row.occupancyPct.toFixed(1)}%` },
    { key: 'revenue', header: 'Revenue', align: 'right', render: (row) => money(row.revenue) },
  ]

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
        activePath="/admin"
        onNavigate={(path) => navigate(path)}
      />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          icon={<BarChart3 className="h-5 w-5" />}
          title="Reports"
          subtitle={
            property
              ? `${property.name} · ${range.label.toLowerCase()} (${dayISO(range.fromOffset)} → ${dayISO(range.toOffset)})`
              : 'Loading…'
          }
          actions={
            <>
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
              <select
                aria-label="Date range"
                value={rangeKey}
                onChange={(e) => setRangeKey(e.target.value as typeof rangeKey)}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {RANGES.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </>
          }
        />

        {status === 'loading' && (
          <p className="py-16 text-center text-sm text-text-secondary">Loading reports…</p>
        )}
        {status === 'error' && (
          <p className="py-16 text-center text-sm text-danger">
            Failed to load reports — is the API server running?
          </p>
        )}

        {status === 'ready' && stats && (
          <>
            {/* stat cards */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard
                variant="progress"
                label="Occupancy (today)"
                value={`${stats.today.occupancyPct.toFixed(0)}%`}
                progress={stats.today.occupancyPct}
                subStats={[
                  { label: 'Arrivals', value: String(stats.today.arrivals) },
                  { label: 'Check-outs', value: String(stats.today.checkoutsToday) },
                ]}
              />
              <StatCard variant="number" label="ADR (range)" value={money(stats.totals.adr)} />
              <StatCard variant="number" label="RevPAR (range)" value={money(stats.totals.revpar)} />
              <StatCard variant="number" label="Bookings in range" value={bookingsInRange} />
            </div>

            {/* charts */}
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-border bg-bg-card p-5">
                <h2 className="label-caps font-semibold">Occupancy % by day</h2>
                <div className="mt-4 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={stats.daily} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="date" tickFormatter={shortDay} tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v) => [`${Number(v).toFixed(1)}%`, 'Occupancy']} />
                      <Area
                        type="monotone"
                        dataKey="occupancyPct"
                        stroke="#2563EB"
                        fill="#DBEAFE"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-bg-card p-5">
                <h2 className="label-caps font-semibold">Revenue by day</h2>
                <div className="mt-4 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.daily} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="date" tickFormatter={shortDay} tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v) => [money(Number(v)), 'Revenue']} />
                      <Bar dataKey="revenue" fill="#2563EB" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-bg-card p-5">
                <h2 className="label-caps font-semibold">Bookings by channel</h2>
                <div className="mt-4 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={stats.channels}
                        dataKey="bookings"
                        nameKey="source"
                        innerRadius="55%"
                        outerRadius="85%"
                        paddingAngle={2}
                      >
                        {stats.channels.map((c) => (
                          <Cell key={c.source} fill={CHANNEL_COLORS[c.source] ?? '#9CA3AF'} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v, name) => [
                          `${v} bookings`,
                          CHANNEL_LABELS[String(name)] ?? String(name),
                        ]}
                      />
                      <Legend
                        formatter={(value: string) => CHANNEL_LABELS[value] ?? value}
                        iconSize={10}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-bg-card p-5">
                <h2 className="label-caps font-semibold">Range totals</h2>
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-text-secondary">Occupancy</dt>
                    <dd className="font-semibold text-text-primary">
                      {stats.totals.occupancyPct.toFixed(1)}%
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-text-secondary">Revenue</dt>
                    <dd className="font-semibold text-text-primary">{money(stats.totals.revenue)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-text-secondary">Occupied bed-nights</dt>
                    <dd className="font-semibold text-text-primary">{stats.totals.occupiedBedNights}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-text-secondary">Available bed-nights</dt>
                    <dd className="font-semibold text-text-primary">{stats.totals.availableBedNights}</dd>
                  </div>
                </dl>
              </div>
            </div>

            {/* daily table */}
            <div>
              <h2 className="label-caps mb-2 font-semibold">Daily breakdown</h2>
              <DataTable
                columns={dailyColumns}
                rows={stats.daily}
                rowKey={(row) => row.date}
                emptyMessage="No days in range."
              />
            </div>
          </>
        )}
      </main>
    </div>
  )
}
