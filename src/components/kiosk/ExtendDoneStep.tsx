import { CheckCircle2 } from 'lucide-react'
import { formatDate } from './KioskShell'

export function ExtendDoneStep({ newCheckOut }: { newCheckOut: string }) {
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <CheckCircle2 className="h-20 w-20 text-success" />
      <h1 className="mt-4 text-3xl font-bold text-text-primary">Stay extended!</h1>
      <p className="mt-6 text-lg text-text-secondary">New check-out</p>
      <p className="mt-1 text-3xl font-bold text-primary">{formatDate(newCheckOut)}</p>
      <p className="mt-6 text-base text-text-secondary">
        This screen clears automatically.
      </p>
    </div>
  )
}
