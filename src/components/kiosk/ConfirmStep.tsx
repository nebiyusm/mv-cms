import {
  formatStay,
  kioskPrimaryBtn,
  kioskSecondaryBtn,
  type KioskBooking,
} from './KioskShell'

export function ConfirmStep({
  booking,
  onConfirm,
  onBack,
}: {
  booking: KioskBooking
  onConfirm: () => void
  onBack: () => void
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary">Confirm your stay</h1>

      <div className="mt-6 rounded-xl border border-border bg-slate-50 p-5">
        <div className="text-xl font-semibold text-text-primary">{booking.guestName}</div>
        <dl className="mt-3 space-y-2 text-lg">
          <div className="flex justify-between">
            <dt className="text-text-secondary">Property</dt>
            <dd className="font-medium text-text-primary">{booking.propertyName}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-secondary">Dates</dt>
            <dd className="font-medium text-text-primary">
              {formatStay(booking.checkIn, booking.checkOut)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-secondary">Room</dt>
            <dd className="font-medium text-text-primary">
              {booking.roomName} · Bed {booking.bedLabel}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-6 space-y-3">
        <button onClick={onConfirm} className={kioskPrimaryBtn}>
          Yes, that's me
        </button>
        <button onClick={onBack} className={kioskSecondaryBtn}>
          Back
        </button>
      </div>
    </div>
  )
}
