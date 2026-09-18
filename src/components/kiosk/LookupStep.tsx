import { useState } from 'react'
import { Search } from 'lucide-react'
import {
  formatDate,
  formatStay,
  kioskPrimaryBtn,
  kioskSecondaryBtn,
  type KioskBooking,
} from './KioskShell'

export function LookupStep({
  searching,
  results,
  error,
  variant = 'checkin',
  onSearch,
  onSelect,
}: {
  searching: boolean
  results: KioskBooking[] | null
  error: string | null
  /** checkin: guests due today; extend: in-house guests adding nights */
  variant?: 'checkin' | 'extend'
  onSearch: (query: string) => void
  onSelect: (booking: KioskBooking) => void
}) {
  const [query, setQuery] = useState('')

  const submit = () => {
    if (query.trim().length >= 2) onSearch(query.trim())
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary">Find your booking</h1>
      <p className="mt-1 text-lg text-text-secondary">
        Enter your name or booking reference.
      </p>

      <div className="mt-6 space-y-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Name or reference"
          autoFocus
          className="min-h-14 w-full rounded-xl border border-gray-300 px-4 text-lg text-text-primary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <button
          onClick={submit}
          disabled={query.trim().length < 2 || searching}
          className={kioskPrimaryBtn}
        >
          <Search className="mr-2 h-5 w-5" />
          {searching ? 'Searching…' : 'Find my booking'}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-base font-medium text-danger">
          {error}
        </p>
      )}

      {results !== null && !error && (
        <div className="mt-6">
          {results.length === 0 ? (
            <div className="text-center">
              <p className="text-lg text-text-secondary">
                {variant === 'extend'
                  ? `We couldn't find an in-house guest under "${query}".`
                  : `We couldn't find a booking due for check-in today under "${query}".`}
              </p>
              <button
                onClick={() => setQuery('')}
                className={`${kioskSecondaryBtn} mt-4`}
              >
                Try again
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {results.map((booking) => (
                <button
                  key={booking.bookingId}
                  onClick={() => onSelect(booking)}
                  className="min-h-14 w-full rounded-xl border border-border bg-slate-50 px-5 py-4 text-left transition-colors hover:border-primary hover:bg-blue-50"
                >
                  <div className="text-lg font-semibold text-text-primary">
                    {booking.guestName}
                  </div>
                  <div className="mt-0.5 text-base text-text-secondary">
                    {variant === 'extend' && booking.currentCheckOut
                      ? `Checks out ${formatDate(booking.currentCheckOut)} · Ref ${booking.reference}`
                      : `${formatStay(booking.checkIn, booking.checkOut)} · ${booking.propertyName} · Ref ${booking.reference}`}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
