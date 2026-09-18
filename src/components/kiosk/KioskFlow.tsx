import { useCallback, useEffect, useRef, useState } from 'react'
import { KioskShell, type KioskBooking, type KioskStep } from './KioskShell'
import { WelcomeStep } from './WelcomeStep'
import { LookupStep } from './LookupStep'
import { ConfirmStep } from './ConfirmStep'
import { PhotoStep } from './PhotoStep'
import { SignatureStep } from './SignatureStep'
import { DoneStep } from './DoneStep'
import { ExtendSummaryStep } from './ExtendSummaryStep'
import { ExtendPayStep } from './ExtendPayStep'
import { ExtendDoneStep } from './ExtendDoneStep'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

const DEFAULT_IDLE_SEC = 60
const DONE_AUTO_RESET_SEC = 15
const PAYMENT_TIMEOUT_MS = 3 * 60 * 1000
const POLL_INTERVAL_MS = 3000

function idleTimeoutSec(): number {
  const raw = new URLSearchParams(window.location.search).get('idleTimeoutSec')
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isNaN(parsed) || parsed < 1) return DEFAULT_IDLE_SEC
  return parsed
}

function addDaysLocal(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

const CHECKIN_ERRORS: Record<string, string> = {
  not_found: "We couldn't find that booking anymore. Please try again.",
  already_checked_in: 'This booking is already checked in.',
  not_due: "This booking isn't due for check-in today.",
  booking_not_active: 'This booking is no longer active. Please see the front desk.',
}

const EXTEND_ERRORS: Record<string, string> = {
  not_found: "We couldn't find that booking anymore. Please start again.",
  not_in_house: 'This booking is no longer in-house. Please see the front desk.',
  nights_exceeded: 'Sorry — your bed was just booked for some of those nights. Please try fewer nights.',
  stripe_unavailable: 'Payments are unavailable right now. Please see the front desk.',
}

interface ExtendSession {
  checkoutUrl: string
  sessionId: string
  amount: number
}

export function KioskFlow() {
  const [step, setStep] = useState<KioskStep>('welcome')
  const [booking, setBooking] = useState<KioskBooking | null>(null)
  const [lookupResults, setLookupResults] = useState<KioskBooking[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [idPhoto, setIdPhoto] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [checkinError, setCheckinError] = useState<string | null>(null)

  // extend-stay branch state
  const [extNights, setExtNights] = useState(1)
  const [extSession, setExtSession] = useState<ExtendSession | null>(null)
  const [extError, setExtError] = useState<string | null>(null)
  const [newCheckOut, setNewCheckOut] = useState<string>('')
  const [notice, setNotice] = useState<string | null>(null)

  const idleSec = useRef(idleTimeoutSec()).current
  const [tick, setTick] = useState(0)

  // Any interaction re-arms the idle timer via `tick`.
  useEffect(() => {
    const onActivity = () => setTick((t) => t + 1)
    window.addEventListener('pointerdown', onActivity)
    window.addEventListener('keydown', onActivity)
    return () => {
      window.removeEventListener('pointerdown', onActivity)
      window.removeEventListener('keydown', onActivity)
    }
  }, [])

  /** Wipe every trace of the session (state lives only in React memory) and
   *  return to Welcome. Unmounting PhotoStep stops the camera stream. */
  const resetAll = useCallback((message: string | null = null) => {
    setStep('welcome')
    setBooking(null)
    setLookupResults(null)
    setSearching(false)
    setLookupError(null)
    setIdPhoto(null)
    setSubmitting(false)
    setCheckinError(null)
    setExtNights(1)
    setExtSession(null)
    setExtError(null)
    setNewCheckOut('')
    setNotice(message)
  }, [])

  useEffect(() => {
    if (step === 'welcome') return
    const isDone = step === 'done' || step === 'ext-done'
    const sec = isDone ? Math.min(DONE_AUTO_RESET_SEC, idleSec) : idleSec
    const timer = setTimeout(() => resetAll(), sec * 1000)
    return () => clearTimeout(timer)
  }, [step, tick, idleSec, resetAll])

  // Poll the payment status while the QR is on screen; give up after 3 min.
  useEffect(() => {
    if (step !== 'ext-pay' || !extSession) return
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/kiosk/extend/status?sessionId=${extSession.sessionId}`)
        if (!res.ok) return
        const body = (await res.json()) as { status: 'paid' | 'pending' }
        if (body.status === 'paid') {
          setNewCheckOut(addDaysLocal(booking?.currentCheckOut ?? '', extNights))
          setStep('ext-done')
        }
      } catch {
        // transient network error — keep polling
      }
    }, POLL_INTERVAL_MS)
    const timeout = setTimeout(
      () => resetAll('Payment was not completed in time. Please start again.'),
      PAYMENT_TIMEOUT_MS,
    )
    return () => {
      clearInterval(poll)
      clearTimeout(timeout)
    }
  }, [step, extSession, booking, extNights, resetAll])

  const search = useCallback(async (query: string) => {
    setSearching(true)
    setLookupError(null)
    setLookupResults(null)
    try {
      const res = await fetch(`${API_BASE}/api/kiosk/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      if (!res.ok) throw new Error(`lookup failed (${res.status})`)
      const body = (await res.json()) as { results: KioskBooking[] }
      setLookupResults(body.results)
    } catch {
      setLookupError('Something went wrong. Please try again or ask the front desk.')
    } finally {
      setSearching(false)
    }
  }, [])

  const extendSearch = useCallback(async (query: string) => {
    setSearching(true)
    setLookupError(null)
    setLookupResults(null)
    try {
      const res = await fetch(`${API_BASE}/api/kiosk/extend/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      if (!res.ok) throw new Error(`quote failed (${res.status})`)
      const body = (await res.json()) as {
        results: {
          bookingId: string
          reference: string
          guestName: string
          roomName: string
          bedLabel: string
          currentCheckOut: string
          nightlyRate: number
          maxNights: number
        }[]
      }
      setLookupResults(
        body.results.map((r) => ({
          bookingId: r.bookingId,
          reference: r.reference,
          guestName: r.guestName,
          roomName: r.roomName,
          bedLabel: r.bedLabel,
          roomType: '',
          checkIn: '',
          checkOut: r.currentCheckOut,
          propertyName: '',
          currentCheckOut: r.currentCheckOut,
          nightlyRate: r.nightlyRate,
          maxNights: r.maxNights,
        })),
      )
    } catch {
      setLookupError('Something went wrong. Please try again or ask the front desk.')
    } finally {
      setSearching(false)
    }
  }, [])

  const checkIn = useCallback(
    async (signature: string) => {
      if (!booking || !idPhoto) return
      setSubmitting(true)
      setCheckinError(null)
      try {
        const res = await fetch(`${API_BASE}/api/kiosk/checkin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: booking.bookingId, idPhoto, signature }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          const code = typeof body?.error === 'string' ? body.error : ''
          throw new Error(
            CHECKIN_ERRORS[code] ?? 'Check-in failed. Please try again or ask the front desk.',
          )
        }
        setStep('done')
      } catch (err) {
        setCheckinError(err instanceof Error ? err.message : 'Check-in failed.')
      } finally {
        setSubmitting(false)
      }
    },
    [booking, idPhoto],
  )

  const startPayment = useCallback(async () => {
    if (!booking) return
    setSubmitting(true)
    setExtError(null)
    try {
      const res = await fetch(`${API_BASE}/api/kiosk/extend/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.bookingId, nights: extNights }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        const code = typeof body?.error === 'string' ? body.error : ''
        throw new Error(
          EXTEND_ERRORS[code] ?? 'Could not start the payment. Please try again.',
        )
      }
      const body = (await res.json()) as ExtendSession
      setExtSession(body)
      setStep('ext-pay')
    } catch (err) {
      setExtError(err instanceof Error ? err.message : 'Could not start the payment.')
    } finally {
      setSubmitting(false)
    }
  }, [booking, extNights])

  return (
    <KioskShell step={step}>
      {step === 'welcome' && (
        <WelcomeStep
          notice={notice}
          onStart={() => {
            setNotice(null)
            setStep('lookup')
          }}
          onExtend={() => {
            setNotice(null)
            setStep('ext-lookup')
          }}
        />
      )}

      {step === 'lookup' && (
        <LookupStep
          searching={searching}
          results={lookupResults}
          error={lookupError}
          onSearch={search}
          onSelect={(b) => {
            setBooking(b)
            setStep('confirm')
          }}
        />
      )}

      {step === 'confirm' && booking && (
        <ConfirmStep
          booking={booking}
          onConfirm={() => setStep('photo')}
          onBack={() => setStep('lookup')}
        />
      )}

      {step === 'photo' && (
        <PhotoStep
          onUse={(dataUrl) => {
            setIdPhoto(dataUrl)
            setStep('signature')
          }}
        />
      )}

      {step === 'signature' && (
        <SignatureStep submitting={submitting} error={checkinError} onComplete={checkIn} />
      )}

      {step === 'done' && booking && <DoneStep booking={booking} />}

      {step === 'ext-lookup' && (
        <LookupStep
          variant="extend"
          searching={searching}
          results={lookupResults}
          error={lookupError}
          onSearch={extendSearch}
          onSelect={(b) => {
            setBooking(b)
            setExtNights(1)
            setStep('ext-summary')
          }}
        />
      )}

      {step === 'ext-summary' && booking && (
        <ExtendSummaryStep
          booking={booking}
          nights={extNights}
          submitting={submitting}
          error={extError}
          onNightsChange={setExtNights}
          onPay={startPayment}
          onBack={() => setStep('ext-lookup')}
        />
      )}

      {step === 'ext-pay' && extSession && (
        <ExtendPayStep checkoutUrl={extSession.checkoutUrl} amount={extSession.amount} />
      )}

      {step === 'ext-done' && <ExtendDoneStep newCheckOut={newCheckOut} />}
    </KioskShell>
  )
}
