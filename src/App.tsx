import { useState } from 'react'
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { CalendarDays, BedDouble, MessageCircle } from 'lucide-react'
import { BedTimeline } from './components/BedTimeline'
import { TopNav } from './components/ui/TopNav'
import { PageHeader } from './components/ui/PageHeader'
import { StatCard } from './components/ui/StatCard'
import { SegmentedCounter } from './components/ui/SegmentedCounter'
import { DataTable, type DataTableColumn } from './components/ui/DataTable'
import { SourceBadge } from './components/ui/SourceBadge'
import { StatusDropdown } from './components/ui/StatusDropdown'
import { ActionButton } from './components/ui/ActionButton'
import { BookingPill } from './components/ui/BookingPill'
import { BlockedCell } from './components/ui/BlockedCell'
import { SOURCE_COLORS, type Platform } from './lib/sourceColors'

/* ------------------------------ sample data ------------------------------ */

const NAV_LINKS = [
  { label: 'Dashboard', path: '/dashboard' },
  { label: 'Calendar', path: '/' },
  { label: 'Guests', path: '/guests' },
  { label: 'Bookings', path: '/bookings' },
]

const OVERFLOW_LINKS = [
  { label: 'Chat', path: '/chat' },
  { label: 'Reports', path: '/reports' },
  { label: 'Pricing', path: '/pricing' },
  { label: 'Channel Manager', path: '/channels' },
  { label: 'Finance', path: '/finance' },
]

const STATUSES = ['Confirmed', 'Checked in', 'Pending', 'Checked out']

interface ActivityRow extends Record<string, unknown> {
  id: number
  guest: string
  platform: Platform
  room: string
  checkIn: string
  nights: number
}

const ACTIVITY_ROWS: ActivityRow[] = [
  { id: 1, guest: 'Sofia Marchetti', platform: 'airbnb', room: 'Mixed Dorm · Bed A', checkIn: 'Sep 17', nights: 3 },
  { id: 2, guest: 'Daniel Otieno', platform: 'booking', room: 'Private Double', checkIn: 'Sep 18', nights: 2 },
  { id: 3, guest: 'Priya Nair', platform: 'hostelworld', room: 'Female Dorm · Bed C', checkIn: 'Sep 17', nights: 5 },
  { id: 4, guest: 'Lukas Weber', platform: 'expedia', room: 'Mixed Dorm · Bed D', checkIn: 'Sep 19', nights: 1 },
  { id: 5, guest: 'Amina Yusuf', platform: 'direct', room: 'Private Double', checkIn: 'Sep 20', nights: 4 },
  { id: 6, guest: 'Tomás Silva', platform: 'agoda', room: 'Mixed Dorm · Bed B', checkIn: 'Sep 21', nights: 2 },
]

/* --------------------------- calendar grid mock --------------------------- */

const DAYS = Array.from({ length: 10 }, (_, i) => {
  const date = new Date(2025, 8, 15 + i) // Sep 15 2025 onwards
  return {
    dow: date.toLocaleDateString('en-US', { weekday: 'short' }),
    day: date.getDate(),
  }
})
const TODAY_INDEX = 2 // Sep 17

type CellItem =
  | { type: 'booking'; start: number; span: number; guest: string; platform: Platform }
  | { type: 'blocked'; start: number; span: number }
  | { type: 'dot'; start: number }

interface BedRow {
  room: string
  bed: string
  items: CellItem[]
}

const CALENDAR_ROWS: BedRow[] = [
  {
    room: 'Mixed Dorm (6-Bed)',
    bed: 'Bed A',
    items: [
      { type: 'booking', start: 0, span: 3, guest: 'Sofia Marchetti', platform: 'airbnb' },
      { type: 'dot', start: 3 },
      { type: 'booking', start: 3, span: 2, guest: 'Jens Berg', platform: 'booking' },
    ],
  },
  {
    room: 'Mixed Dorm (6-Bed)',
    bed: 'Bed B',
    items: [
      { type: 'blocked', start: 1, span: 2 },
      { type: 'booking', start: 4, span: 4, guest: 'Priya Nair', platform: 'hostelworld' },
    ],
  },
  {
    room: 'Private Double',
    bed: 'Room',
    items: [
      { type: 'booking', start: 1, span: 3, guest: 'Lukas Weber', platform: 'expedia' },
      { type: 'dot', start: 4 },
      { type: 'booking', start: 4, span: 3, guest: 'Amina Yusuf', platform: 'direct' },
    ],
  },
  {
    room: 'Female Dorm (4-Bed)',
    bed: 'Bed A',
    items: [{ type: 'booking', start: 6, span: 4, guest: 'Tomás Silva', platform: 'agoda' }],
  },
  {
    room: 'Female Dorm (4-Bed)',
    bed: 'Bed B',
    items: [{ type: 'blocked', start: 7, span: 2 }],
  },
]

const GRID_TEMPLATE = `140px repeat(${DAYS.length}, minmax(72px, 1fr))`

function CalendarGridMock() {
  const rows: React.ReactNode[] = []
  let gridRow = 2 // row 1 is the day header

  // Day header
  rows.push(
    <div
      key="corner"
      className="label-caps flex items-end border-b border-border pb-2"
      style={{ gridRow: 1, gridColumn: 1 }}
    >
      Room / Bed
    </div>,
  )
  DAYS.forEach((d, i) => {
    const isToday = i === TODAY_INDEX
    rows.push(
      <div
        key={`day-${i}`}
        className={`flex flex-col items-center border-b pb-2 pt-1 text-center ${
          isToday ? 'rounded-t-md border-primary bg-primary text-white' : 'border-border'
        }`}
        style={{ gridRow: 1, gridColumn: i + 2 }}
      >
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${isToday ? 'text-blue-100' : 'text-gray-400'}`}>
          {d.dow}
        </span>
        <span className={`text-sm font-bold ${isToday ? 'text-white' : 'text-text-primary'}`}>
          {d.day}
        </span>
      </div>,
    )
  })

  // Bed rows, grouped by room
  let lastRoom = ''
  CALENDAR_ROWS.forEach((bedRow, rowIndex) => {
    gridRow += 1
    const showRoom = bedRow.room !== lastRoom
    lastRoom = bedRow.room
    rows.push(
      <div
        key={`label-${rowIndex}`}
        className="flex flex-col justify-center border-b border-border py-1 pr-3"
        style={{ gridRow, gridColumn: 1 }}
      >
        {showRoom && (
          <span className="text-xs font-bold text-text-primary">{bedRow.room}</span>
        )}
        <span className="text-xs text-text-secondary">{bedRow.bed}</span>
      </div>,
    )

    // Track which day columns are covered so uncovered ones get an empty cell
    // (keeps the light row divider + today highlight running across the row)
    for (let d = 0; d < DAYS.length; d++) {
      rows.push(
        <div
          key={`bg-${rowIndex}-${d}`}
          className={`border-b ${d === TODAY_INDEX ? 'border-blue-100 bg-blue-50' : 'border-border'}`}
          style={{ gridRow, gridColumn: d + 2 }}
        />,
      )
    }

    bedRow.items.forEach((item, itemIndex) => {
      const col = item.start + 2
      if (item.type === 'dot') {
        rows.push(
          <div
            key={`item-${rowIndex}-${itemIndex}`}
            className="z-10 flex items-center justify-center"
            style={{ gridRow, gridColumn: col }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
          </div>,
        )
      } else if (item.type === 'blocked') {
        rows.push(
          <BlockedCell
            key={`item-${rowIndex}-${itemIndex}`}
            gridColumn={`${col} / span ${item.span}`}
            className="z-10 mx-0.5 self-center"
            style={{ gridRow }}
          />,
        )
      } else {
        rows.push(
          <BookingPill
            key={`item-${rowIndex}-${itemIndex}`}
            guestName={item.guest}
            platform={item.platform}
            gridColumn={`${col} / span ${item.span}`}
            className="z-10 mx-0.5 self-center"
            style={{ gridRow }}
          />,
        )
      }
    })
  })

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-bg-card p-4">
      <div className="grid min-w-[900px] gap-y-1" style={{ gridTemplateColumns: GRID_TEMPLATE }}>
        {rows}
      </div>
    </div>
  )
}

/* ------------------------------ demo sections ----------------------------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="label-caps border-b border-border pb-2">{title}</h2>
      {children}
    </section>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<BedTimeline />} />
        <Route path="/demo" element={<DemoPage />} />
      </Routes>
    </BrowserRouter>
  )
}

function DemoPage() {
  const navigate = useNavigate()
  const [property, setProperty] = useState('Addis Ababa')
  const [currency, setCurrency] = useState('USD')
  const [activePath, setActivePath] = useState('/demo')
  const [segment, setSegment] = useState(0)
  const [rowStatuses, setRowStatuses] = useState<string[]>(
    ACTIVITY_ROWS.map((_, i) => STATUSES[i % STATUSES.length]),
  )
  const [standaloneStatus, setStandaloneStatus] = useState('Confirmed')

  const columns: DataTableColumn<ActivityRow>[] = [
    {
      key: 'guest',
      header: 'Guest',
      render: (row) => (
        <span className="flex items-center gap-2">
          <a
            href="#"
            onClick={(e) => e.preventDefault()}
            className="font-medium text-primary hover:underline"
          >
            {row.guest}
          </a>
          <MessageCircle className="h-4 w-4 text-success" />
        </span>
      ),
    },
    {
      key: 'platform',
      header: 'Platform',
      render: (row) => (
        <span className="flex items-center gap-2">
          <SourceBadge platform={row.platform} />
          <span>{SOURCE_COLORS[row.platform].label}</span>
        </span>
      ),
    },
    {
      key: 'room',
      header: 'Room / Bed',
      render: (row) => (
        <span className="flex items-center gap-2">
          <BedDouble className="h-4 w-4 text-gray-400" />
          <span>{row.room}</span>
        </span>
      ),
    },
    { key: 'checkIn', header: 'Check-in' },
    { key: 'nights', header: 'Nights' },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (_row, rowIndex) => (
        <span className="flex items-center justify-end gap-2">
          <StatusDropdown
            options={STATUSES}
            value={rowStatuses[rowIndex]}
            onChange={(value) =>
              setRowStatuses((prev) => prev.map((s, i) => (i === rowIndex ? value : s)))
            }
          />
          <ActionButton onClick={() => alert(`Updated booking for ${_row.guest}`)}>
            Update
          </ActionButton>
        </span>
      ),
    },
  ]

  return (
    <div className="min-h-screen bg-bg-page">
      <TopNav
        properties={['Addis Ababa', 'Nairobi']}
        selectedProperty={property}
        onPropertyChange={setProperty}
        currencies={['USD', 'ETB', 'KES']}
        selectedCurrency={currency}
        onCurrencyChange={setCurrency}
        links={NAV_LINKS}
        activePath={activePath}
        onNavigate={(path) => {
          setActivePath(path)
          if (path === '/' || path === '/demo') navigate(path)
        }}
        overflowLinks={OVERFLOW_LINKS}
        onLogout={() => alert('Logged out')}
      />

      <main className="mx-auto max-w-7xl space-y-10 px-4 py-8 sm:px-6">
        <Section title="PageHeader">
          <PageHeader
            icon={<CalendarDays className="h-5 w-5" />}
            title="Dashboard"
            subtitle={`${property} · Tuesday, Sep 17, 2025`}
            actions={
              <>
                <StatusDropdown
                  options={['Today', 'This week', 'This month']}
                  value="Today"
                  onChange={() => {}}
                  ariaLabel="Date range"
                />
                <ActionButton>Add Guest</ActionButton>
              </>
            }
          />
        </Section>

        <Section title="StatCard (number / list / progress)">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard variant="number" label="Arrivals Today" value={17} />
            <StatCard
              variant="list"
              label="Rates Tonight"
              items={[
                { label: 'Mixed Dorm', dotColor: '#10B981', value: '$14' },
                { label: 'Female Dorm', dotColor: '#10B981', value: '$16' },
                { label: 'Private Double', dotColor: '#F59E0B', value: '$38' },
              ]}
            />
            <StatCard
              variant="progress"
              label="Occupancy"
              value="9 / 12"
              progress={75}
              subStats={[
                { label: 'Beds free', value: '3' },
                { label: 'Tonight', value: '75%' },
              ]}
            />
          </div>
        </Section>

        <Section title="SegmentedCounter">
          <SegmentedCounter
            items={[
              { label: 'Arrivals', count: 17 },
              { label: 'Departures', count: 6 },
              { label: 'Stayovers', count: 23 },
              { label: 'No-shows', count: 1 },
            ]}
            activeIndex={segment}
            onSelect={setSegment}
          />
        </Section>

        <Section title="DataTable (with SourceBadge, StatusDropdown, ActionButton)">
          <DataTable
            columns={columns}
            rows={ACTIVITY_ROWS}
            rowKey={(row) => row.id}
          />
        </Section>

        <Section title="SourceBadge (all platforms)">
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-bg-card p-5">
            {(Object.keys(SOURCE_COLORS) as Platform[]).map((platform) => (
              <span key={platform} className="flex items-center gap-2 text-sm text-text-primary">
                <SourceBadge platform={platform} />
                {SOURCE_COLORS[platform].label}
              </span>
            ))}
          </div>
        </Section>

        <Section title="StatusDropdown + ActionButton">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-card p-5">
            <StatusDropdown
              options={STATUSES}
              value={standaloneStatus}
              onChange={setStandaloneStatus}
            />
            <ActionButton onClick={() => alert(`Status: ${standaloneStatus}`)}>
              Update
            </ActionButton>
          </div>
        </Section>

        <Section title="BookingPill + BlockedCell">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg-card p-5">
            <BookingPill guestName="Sofia Marchetti" platform="airbnb" />
            <BookingPill guestName="Daniel Otieno" platform="booking" />
            <BookingPill guestName="Priya Nair" platform="hostelworld" />
            <BookingPill guestName="Lukas Weber" platform="expedia" />
            <BookingPill guestName="Tomás Silva" platform="agoda" />
            <BookingPill guestName="Amina Yusuf" platform="direct" />
            <BlockedCell className="w-24" />
          </div>
        </Section>

        <Section title="Calendar grid mock (composition preview)">
          <CalendarGridMock />
        </Section>
      </main>
    </div>
  )
}
