import { kioskPrimaryBtn, kioskSecondaryBtn } from './KioskShell'

export function WelcomeStep({
  notice,
  onStart,
  onExtend,
}: {
  notice: string | null
  onStart: () => void
  onExtend: () => void
}) {
  return (
    <div className="flex flex-col items-center py-10 text-center">
      <h1 className="text-3xl font-bold text-text-primary">Welcome to Mad Vervet</h1>
      <p className="mt-3 text-lg text-text-secondary">
        Check yourself in — or add nights to your stay.
      </p>

      {notice && (
        <p role="alert" className="mt-6 w-full rounded-lg bg-amber-50 px-4 py-3 text-base font-medium text-amber-700">
          {notice}
        </p>
      )}

      <div className="mt-10 w-full space-y-4">
        <button onClick={onStart} className={`${kioskPrimaryBtn} h-20 text-2xl`}>
          Touch to check in
        </button>
        <button onClick={onExtend} className={`${kioskSecondaryBtn} h-20 text-2xl`}>
          Extend my stay
        </button>
      </div>
    </div>
  )
}
