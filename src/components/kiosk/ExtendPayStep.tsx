import { QRCodeSVG } from 'qrcode.react'

export function ExtendPayStep({
  checkoutUrl,
  amount,
}: {
  checkoutUrl: string
  amount: number
}) {
  return (
    <div className="flex flex-col items-center py-4 text-center">
      <h1 className="text-2xl font-bold text-text-primary">Scan with your phone to pay</h1>
      <p className="mt-2 text-lg text-text-secondary">
        Total due: <span className="font-semibold text-text-primary">${amount.toFixed(2)}</span>
      </p>

      <div className="mt-6 rounded-xl border border-border bg-white p-4">
        <QRCodeSVG value={checkoutUrl} size={240} level="M" />
      </div>

      <p className="mt-6 animate-pulse text-base text-text-secondary">
        Waiting for payment…
      </p>
    </div>
  )
}
