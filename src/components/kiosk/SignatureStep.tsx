import { useEffect, useRef, useState } from 'react'
import { Eraser } from 'lucide-react'
import { kioskPrimaryBtn, kioskSecondaryBtn } from './KioskShell'

export function SignatureStep({
  submitting,
  error,
  onComplete,
}: {
  submitting: boolean
  error: string | null
  onComplete: (dataUrl: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [hasDrawn, setHasDrawn] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111827'
  }, [])

  const pointFrom = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    drawing.current = true
    canvasRef.current?.setPointerCapture(e.pointerId)
    const { x, y } = pointFrom(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + 0.1, y + 0.1) // a dot on tap
    ctx.stroke()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawing.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const { x, y } = pointFrom(e)
    ctx.lineTo(x, y)
    ctx.stroke()
    setHasDrawn(true)
  }

  const endStroke = () => {
    drawing.current = false
  }

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasDrawn(false)
  }

  const finish = () => {
    const canvas = canvasRef.current
    if (!canvas || !hasDrawn) return
    onComplete(canvas.toDataURL('image/png'))
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary">Sign to check in</h1>
      <p className="mt-1 text-lg text-text-secondary">
        Sign inside the box with your finger.
      </p>

      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        className="mt-6 h-64 w-full touch-none rounded-xl border border-border bg-white"
      />

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-base font-medium text-danger">
          {error}
        </p>
      )}

      <div className="mt-6 space-y-3">
        <button onClick={finish} disabled={!hasDrawn || submitting} className={kioskPrimaryBtn}>
          {submitting ? 'Checking you in…' : 'Continue'}
        </button>
        <button onClick={clear} disabled={submitting} className={kioskSecondaryBtn}>
          <Eraser className="mr-2 h-5 w-5" />
          Clear
        </button>
      </div>
    </div>
  )
}
