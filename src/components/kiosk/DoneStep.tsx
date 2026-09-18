import { CheckCircle2 } from 'lucide-react'
import type { KioskBooking } from './KioskShell'

export function DoneStep({ booking }: { booking: KioskBooking }) {
  const firstName = booking.guestName.split(' ')[0]
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <CheckCircle2 className="h-20 w-20 text-success" />
      <h1 className="mt-4 text-3xl font-bold text-text-primary">
        You're checked in{firstName ? `, ${firstName}` : ''}!
      </h1>
      <p className="mt-6 text-lg text-text-secondary">Head to</p>
      <p className="mt-1 text-3xl font-bold text-primary">
        {booking.roomName} · Bed {booking.bedLabel}
      </p>
      <p className="mt-6 text-base text-text-secondary">
        This screen clears automatically.
      </p>
    </div>
  )
}
