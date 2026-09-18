import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, RotateCcw } from 'lucide-react'
import { kioskPrimaryBtn, kioskSecondaryBtn } from './KioskShell'

export function PhotoStep({ onUse }: { onUse: (dataUrl: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [captured, setCaptured] = useState<string | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (captured) return // stream not needed while previewing the capture
    let cancelled = false
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          void videoRef.current.play()
        }
      })
      .catch(() => setCameraError('Camera unavailable. Please ask the front desk for help.'))
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [captured, nonce])

  const capture = useCallback(() => {
    const video = videoRef.current
    if (!video || video.videoWidth === 0) return
    const scale = Math.min(1, 1280 / video.videoWidth)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
    setCaptured(canvas.toDataURL('image/jpeg', 0.85))
  }, [])

  const retake = () => {
    setCaptured(null)
    setNonce((n) => n + 1)
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary">Take a photo of your ID</h1>
      <p className="mt-1 text-lg text-text-secondary">
        Hold your passport or ID card up to the camera.
      </p>

      <div className="mt-6 overflow-hidden rounded-xl border border-border bg-black">
        {captured ? (
          <img src={captured} alt="Captured ID" className="aspect-[4/3] w-full object-cover" />
        ) : (
          <video ref={videoRef} muted playsInline className="aspect-[4/3] w-full object-cover" />
        )}
      </div>

      {cameraError && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-base font-medium text-danger">
          {cameraError}
        </p>
      )}

      <div className="mt-6 space-y-3">
        {captured ? (
          <>
            <button onClick={() => onUse(captured)} className={kioskPrimaryBtn}>
              Use photo
            </button>
            <button onClick={retake} className={kioskSecondaryBtn}>
              <RotateCcw className="mr-2 h-5 w-5" />
              Retake
            </button>
          </>
        ) : (
          <button onClick={capture} disabled={Boolean(cameraError)} className={kioskPrimaryBtn}>
            <Camera className="mr-2 h-5 w-5" />
            Capture
          </button>
        )}
      </div>
    </div>
  )
}
