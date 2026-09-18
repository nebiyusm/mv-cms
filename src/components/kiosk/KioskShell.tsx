import type { ReactNode } from 'react'
import { BedDouble } from 'lucide-react'

/** Big touch-friendly button styles shared by all kiosk steps (min 56px targets). */
export const kioskPrimaryBtn =
  'flex min-h-14 w-full items-center justify-center rounded-xl bg-primary px-6 text-lg font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50'

export const kioskSecondaryBtn =
  'flex min-h-14 w-full items-center justify-center rounded-xl border border-gray-300 bg-white px-6 text-lg font-medium text-text-primary transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50'

export interface KioskBooking {
  bookingId: string
  reference: string
  guestName: string
  roomName: string
  bedLabel: string
  roomType: string
  checkIn: string
  checkOut: string
  propertyName: string
  /** Extend-stay quote fields (present only in the extend branch) */
  currentCheckOut?: string
  nightlyRate?: number
  maxNights?: number
}

export type KioskStep =
  | 'welcome'
  | 'lookup'
  | 'confirm'
  | 'photo'
  | 'signature'
  | 'done'
  | 'ext-lookup'
  | 'ext-summary'
  | 'ext-pay'
  | 'ext-done'

interface StepSequence {
  steps: KioskStep[]
  labels: string[]
}

const SEQUENCES: Record<'checkin' | 'extend', StepSequence> = {
  checkin: {
    steps: ['lookup', 'confirm', 'photo', 'signature', 'done'],
    labels: ['Find booking', 'Confirm', 'ID photo', 'Signature', 'Done'],
  },
  extend: {
    steps: ['ext-lookup', 'ext-summary', 'ext-pay', 'ext-done'],
    labels: ['Find booking', 'Choose nights', 'Pay', 'Done'],
  },
}

export function formatStay(checkIn: string, checkOut: string): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(checkIn)} → ${fmt(checkOut)}`
}

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export function KioskShell({
  step,
  children,
}: {
  step: KioskStep
  children: ReactNode
}) {
  const sequence = SEQUENCES[step.startsWith('ext-') ? 'extend' : 'checkin']
  const activeIndex = sequence.steps.indexOf(step)
  return (
    <div className="flex min-h-screen flex-col bg-bg-page">
      <header className="flex items-center justify-center gap-3 py-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-white">
          <BedDouble className="h-7 w-7" />
        </div>
        <div className="leading-tight">
          <div className="text-xl font-bold text-text-primary">Mad Vervet</div>
          <div className="text-sm text-text-secondary">Self check-in</div>
        </div>
      </header>

      {step !== 'welcome' && (
        <div className="flex items-center justify-center gap-2 pb-4" aria-label="Progress">
          {sequence.labels.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`h-2.5 w-2.5 rounded-full ${
                  i <= activeIndex ? 'bg-primary' : 'bg-gray-300'
                }`}
                title={label}
              />
            </div>
          ))}
        </div>
      )}

      <main className="mx-auto w-full max-w-lg flex-1 px-4 pb-10">
        <div className="rounded-2xl border border-border bg-bg-card p-6 shadow-sm sm:p-8">
          {children}
        </div>
      </main>
    </div>
  )
}
