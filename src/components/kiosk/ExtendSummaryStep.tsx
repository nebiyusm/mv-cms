import { Minus, Plus } from 'lucide-react'
import {
  formatDate,
  kioskPrimaryBtn,
  kioskSecondaryBtn,
  type KioskBooking,
} from './KioskShell'

export function ExtendSummaryStep({
  booking,
  nights,
  submitting,
  error,
  onNightsChange,
  onPay,
  onBack,
}: {
  booking: KioskBooking
  nights: number
  submitting: boolean
  error: string | null
  onNightsChange: (nights: number) => void
  onPay: () => void
  onBack: () => void
}) {
  const rate = booking.nightlyRate ?? 0
  const maxNights = booking.maxNights ?? 1
  const total = rate * nights

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary">Extend your stay</h1>

      <div className="mt-6 rounded-xl border border-border bg-slate-50 p-5">
        <div className="text-xl font-semibold text-text-primary">
          {booking.roomName} · Bed {booking.bedLabel}
        </div>
        <dl className="mt-3 space-y-2 text-lg">
          <div className="flex justify-between">
            <dt className="text-text-secondary">Current check-out</dt>
            <dd className="font-medium text-text-primary">
              {booking.currentCheckOut ? formatDate(booking.currentCheckOut) : '—'}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-secondary">Nightly rate</dt>
            <dd className="font-medium text-text-primary">${rate.toFixed(2)}</dd>
          </div>
        </dl>
      </div>

      {maxNights === 0 ? (
        <p role="alert" className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-base font-medium text-amber-700">
          Sorry — your bed is booked from {booking.currentCheckOut ? formatDate(booking.currentCheckOut) : 'check-out'}.
          Please see the front desk to move rooms.
        </p>
      ) : (
        <>
          <div className="mt-6 flex items-center justify-between">
            <span className="text-lg text-text-secondary">Extra nights</span>
            <div className="flex items-center gap-4">
              <button
                onClick={() => onNightsChange(Math.max(1, nights - 1))}
                disabled={nights <= 1}
                aria-label="One night fewer"
                className="flex h-14 w-14 items-center justify-center rounded-xl border border-gray-300 bg-white text-text-primary hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Minus className="h-6 w-6" />
              </button>
              <span className="w-10 text-center text-3xl font-bold text-text-primary">{nights}</span>
              <button
                onClick={() => onNightsChange(Math.min(maxNights, nights + 1))}
                disabled={nights >= maxNights}
                aria-label="One more night"
                className="flex h-14 w-14 items-center justify-center rounded-xl border border-gray-300 bg-white text-text-primary hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-6 w-6" />
              </button>
            </div>
          </div>

          {error && (
            <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-base font-medium text-danger">
              {error}
            </p>
          )}

          <div className="mt-6 space-y-3">
            <button onClick={onPay} disabled={submitting} className={kioskPrimaryBtn}>
              {submitting ? 'Preparing payment…' : `Pay $${total.toFixed(2)}`}
            </button>
            <button onClick={onBack} className={kioskSecondaryBtn}>
              Back
            </button>
          </div>
        </>
      )}
    </div>
  )
}
