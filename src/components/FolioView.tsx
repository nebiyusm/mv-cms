import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Receipt, Wallet } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '../lib/supabase'
import { TopNav } from './ui/TopNav'
import { PageHeader } from './ui/PageHeader'
import { ActionButton } from './ui/ActionButton'
import { DataTable, type DataTableColumn } from './ui/DataTable'

/* --------------------------------- types --------------------------------- */

interface FolioRow extends Record<string, unknown> {
  folioId: string
  bookingId: string | null
  reference: string | null
  guestName: string
  status: string
  currency: string
  charges: number
  payments: number
  balance: number
}

interface LineItem {
  id: string
  type: 'room' | 'extension' | 'pos' | 'payment'
  description: string
  amount: number
  createdAt: string
  externalRef: string | null
}

interface LineItemRow extends Record<string, unknown>, LineItem {}

interface FolioDetail extends FolioRow {
  items: LineItem[]
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

const money = (n: number) => `$${Math.abs(n).toFixed(2)}`

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

const TYPE_BADGE: Record<LineItem['type'], string> = {
  room: 'bg-blue-100 text-primary',
  extension: 'bg-violet-100 text-violet-700',
  pos: 'bg-amber-100 text-amber-700',
  payment: 'bg-emerald-100 text-emerald-700',
}

/* ------------------------------ shared chrome ----------------------------- */

function StaffChrome({
  children,
  title,
  subtitle,
  icon,
  actions,
}: {
  children: React.ReactNode
  title: string
  subtitle: string
  icon: React.ReactNode
  actions?: React.ReactNode
}) {
  const navigate = useNavigate()
  const [properties, setProperties] = useState<PropertyRow[]>([])
  const [propertyCode, setPropertyCode] = useState('ADD')
  const [currency, setCurrency] = useState('USD')

  useEffect(() => {
    supabase
      .from('properties')
      .select('id, code, name')
      .order('code')
      .then(({ data }) => setProperties(data ?? []))
  }, [])

  return (
    <div className="min-h-screen bg-bg-page">
      <TopNav
        properties={properties.map((p) => p.name)}
        selectedProperty={properties.find((p) => p.code === propertyCode)?.name ?? ''}
        onPropertyChange={(name) => {
          const next = properties.find((p) => p.name === name)
          if (next) setPropertyCode(next.code)
        }}
        currencies={['USD', 'ETB', 'KES']}
        selectedCurrency={currency}
        onCurrencyChange={setCurrency}
        links={NAV_LINKS}
        activePath="/folios"
        onNavigate={(path) => navigate(path)}
      />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader icon={icon} title={title} subtitle={subtitle} actions={actions} />
        {children}
      </main>
    </div>
  )
}

/* -------------------------------- list view ------------------------------- */

function FolioList() {
  const navigate = useNavigate()
  const [folios, setFolios] = useState<FolioRow[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/folios?propertyCode=ADD`)
      if (!res.ok) throw new Error(`status ${res.status}`)
      const body = (await res.json()) as { folios: FolioRow[] }
      setFolios(body.folios)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const channel = supabase
      .channel('folio-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'folio_line_items' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'folios' }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [load])

  const columns: DataTableColumn<FolioRow>[] = [
    {
      key: 'guestName',
      header: 'Guest',
      render: (row) => (
        <Link
          to={`/folios/${row.folioId}`}
          className="font-medium text-primary hover:underline"
        >
          {row.guestName}
        </Link>
      ),
    },
    { key: 'reference', header: 'Booking ref' },
    { key: 'charges', header: 'Charges', render: (row) => money(row.charges) },
    { key: 'payments', header: 'Payments', render: (row) => money(row.payments) },
    {
      key: 'balance',
      header: 'Balance',
      render: (row) => (
        <span className={`font-semibold ${row.balance > 0 ? 'text-danger' : 'text-success'}`}>
          {money(row.balance)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-2">
          <ActionButton onClick={() => navigate(`/folios/${row.folioId}?action=charge`)}>
            Add charge
          </ActionButton>
          <ActionButton
            disabled={row.balance <= 0}
            onClick={() => navigate(`/folios/${row.folioId}?action=pay`)}
          >
            Charge balance
          </ActionButton>
        </div>
      ),
    },
  ]

  return (
    <StaffChrome
      icon={<Wallet className="h-5 w-5" />}
      title="Folios"
      subtitle="Open guest folios — charges, payments and balances"
    >
      {status === 'loading' && (
        <p className="py-10 text-center text-sm text-text-secondary">Loading folios…</p>
      )}
      {status === 'error' && (
        <p className="py-10 text-center text-sm text-danger">
          Failed to load folios — is the API server running?
        </p>
      )}
      {status === 'ready' && (
        <DataTable
          columns={columns}
          rows={folios}
          rowKey={(row) => row.folioId}
          emptyMessage="No open folios."
        />
      )}
    </StaffChrome>
  )
}

/* ------------------------------- detail view ------------------------------ */

interface PaySession {
  checkoutUrl: string
  sessionId: string
  amount: number
}

function FolioDetailView({ folioId }: { folioId: string }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [folio, setFolio] = useState<FolioDetail | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [chargeFormOpen, setChargeFormOpen] = useState(searchParams.get('action') === 'charge')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paySession, setPaySession] = useState<PaySession | null>(null)
  const autoPay = useRef(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/folios/${folioId}`)
      if (!res.ok) throw new Error(`status ${res.status}`)
      setFolio((await res.json()) as FolioDetail)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [folioId])

  useEffect(() => {
    void load()
  }, [load])

  // Realtime reconciliation: the Stripe webhook writes the payment row and
  // this view updates live — no polling.
  useEffect(() => {
    const channel = supabase
      .channel(`folio-${folioId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'folio_line_items' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'folios' }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [folioId, load])

  const startCheckout = useCallback(async () => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/folios/${folioId}/checkout`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error === 'nothing_to_pay' ? 'Nothing to pay' : `Checkout failed (${res.status})`)
      }
      setPaySession((await res.json()) as PaySession)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed')
    } finally {
      setSubmitting(false)
    }
  }, [folioId])

  // ?action=pay deep link from the list page — fire checkout once loaded.
  useEffect(() => {
    if (status === 'ready' && searchParams.get('action') === 'pay' && !autoPay.current && !paySession) {
      autoPay.current = true
      setSearchParams({}, { replace: true })
      void startCheckout()
    }
  }, [status, searchParams, setSearchParams, paySession, startCheckout])

  async function addCharge(e: React.FormEvent) {
    e.preventDefault()
    const value = Number.parseFloat(amount)
    if (!description.trim() || !Number.isFinite(value) || value <= 0) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/folios/${folioId}/charges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description.trim(), amount: value }),
      })
      if (!res.ok) throw new Error(`Add charge failed (${res.status})`)
      setDescription('')
      setAmount('')
      setChargeFormOpen(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add charge failed')
    } finally {
      setSubmitting(false)
    }
  }

  const itemColumns: DataTableColumn<LineItemRow>[] = useMemo(
    () => [
      { key: 'createdAt', header: 'Date', render: (row) => fmtDateTime(row.createdAt) },
      { key: 'description', header: 'Description' },
      {
        key: 'type',
        header: 'Type',
        render: (row) => (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_BADGE[row.type]}`}>
            {row.type}
          </span>
        ),
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        render: (row) => (
          <span className={row.amount < 0 ? 'font-medium text-success' : 'text-text-primary'}>
            {row.amount < 0 ? `−${money(row.amount)}` : money(row.amount)}
          </span>
        ),
      },
    ],
    [],
  )

  const settled = folio !== null && folio.balance <= 0 && folio.payments > 0

  return (
    <StaffChrome
      icon={<Receipt className="h-5 w-5" />}
      title={folio ? folio.guestName : 'Folio'}
      subtitle={
        folio
          ? `Booking ref ${folio.reference ?? '—'} · ${folio.status === 'open' ? 'Open' : 'Closed'} folio`
          : 'Loading…'
      }
      actions={
        <>
          <Link to="/folios" className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-slate-100">
            All folios
          </Link>
          <ActionButton onClick={() => setChargeFormOpen((v) => !v)}>Add charge</ActionButton>
          <ActionButton
            disabled={submitting || !folio || folio.balance <= 0}
            onClick={() => void startCheckout()}
          >
            Charge balance
          </ActionButton>
        </>
      }
    >
      {status === 'loading' && (
        <p className="py-10 text-center text-sm text-text-secondary">Loading folio…</p>
      )}
      {status === 'error' && (
        <p className="py-10 text-center text-sm text-danger">Failed to load the folio.</p>
      )}

      {status === 'ready' && folio && (
        <>
          {error && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-danger">
              {error}
            </p>
          )}

          {chargeFormOpen && (
            <form
              onSubmit={addCharge}
              className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-bg-card p-4"
            >
              <div className="min-w-52 flex-1">
                <label htmlFor="charge-desc" className="label-caps mb-1 block">Description</label>
                <input
                  id="charge-desc"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Laundry"
                  maxLength={120}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="w-32">
                <label htmlFor="charge-amount" className="label-caps mb-1 block">Amount</label>
                <input
                  id="charge-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <ActionButton type="submit" disabled={submitting || !description.trim() || !amount}>
                Add
              </ActionButton>
            </form>
          )}

          {paySession && !settled && (
            <div className="flex items-center gap-5 rounded-lg border border-border bg-bg-card p-5">
              <div className="rounded-lg border border-border bg-white p-3">
                <QRCodeSVG value={paySession.checkoutUrl} size={140} level="M" />
              </div>
              <div>
                <div className="text-base font-semibold text-text-primary">Guest scans to pay</div>
                <div className="mt-1 text-sm text-text-secondary">
                  {money(paySession.amount)} due — the balance updates here automatically.
                </div>
                <a
                  href={paySession.checkoutUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 block break-all text-sm text-primary hover:underline"
                >
                  {paySession.checkoutUrl}
                </a>
              </div>
            </div>
          )}

          {settled && (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
              Settled — payment received, balance $0.00.
            </p>
          )}

          <div>
            <DataTable
              columns={itemColumns}
              rows={folio.items as LineItemRow[]}
              rowKey={(row) => row.id}
              emptyMessage="No line items yet."
            />
            <div className="mt-3 flex justify-end gap-8 text-sm">
              <span className="text-text-secondary">
                Charges <span className="font-medium text-text-primary">{money(folio.charges)}</span>
              </span>
              <span className="text-text-secondary">
                Payments <span className="font-medium text-text-primary">{money(folio.payments)}</span>
              </span>
              <span className="text-text-secondary">
                Balance{' '}
                <span className={`text-base font-bold ${folio.balance > 0 ? 'text-danger' : 'text-success'}`}>
                  {money(folio.balance)}
                </span>
              </span>
            </div>
          </div>
        </>
      )}
    </StaffChrome>
  )
}

/* --------------------------------- entry --------------------------------- */

export function FolioView() {
  const { id } = useParams()
  return id ? <FolioDetailView folioId={id} /> : <FolioList />
}
