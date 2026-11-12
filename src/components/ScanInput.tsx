import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Camera, ScanLine, X } from 'lucide-react'
import { Button } from './ui'

// One box for every way to enter a barcode:
//  • USB / Bluetooth scanners type the digits and press Enter (keyboard wedge)
//  • "Camera" opens the phone or laptop camera and reads printed labels
//  • or type a barcode / SKU by hand
export function ScanInput({ onScan, placeholder = 'Scan or type a barcode / SKU', autoFocus, continuous }: {
  onScan: (code: string) => void
  placeholder?: string
  autoFocus?: boolean
  continuous?: boolean   // keep the camera open for several items (POS)
}) {
  const [value, setValue] = useState('')
  const [camera, setCamera] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const code = value.trim()
    if (code) onScan(code)
    setValue('')
  }

  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <ScanLine className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-duck-600" />
        <input ref={input} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={onKey} autoFocus={autoFocus}
          placeholder={placeholder} inputMode="numeric" autoComplete="off" data-scan-input
          className="h-10 w-full rounded-md border border-gray-300 bg-white pl-8 pr-2 font-mono text-sm shadow-xs focus:border-duck-500 focus:outline-none focus:ring-2 focus:ring-duck-200" />
      </div>
      <Button type="button" onClick={() => setCamera(true)} className="h-10"><Camera className="size-4" />Camera</Button>
      {camera && (
        <CameraScanner continuous={continuous}
          onResult={(code) => { onScan(code); if (!continuous) setCamera(false) }}
          onClose={() => { setCamera(false); input.current?.focus() }} />
      )}
    </div>
  )
}

function CameraScanner({ onResult, onClose, continuous }: { onResult: (code: string) => void; onClose: () => void; continuous?: boolean }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [last, setLast] = useState<string | null>(null)
  const onResultRef = useRef(onResult)
  useEffect(() => { onResultRef.current = onResult })

  useEffect(() => {
    let stop: (() => void) | undefined
    let cancelled = false
    const seen = new Map<string, number>()
    ;(async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        if (cancelled || !video.current) return
        const reader = new BrowserMultiFormatReader()
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: 'environment' } }, video.current,
          (result) => {
            if (!result) return
            const code = result.getText()
            const now = Date.now()
            if (now - (seen.get(code) ?? 0) < 1500) return   // the camera sees the same label many times a second
            seen.set(code, now)
            setLast(code)
            onResultRef.current(code)
          })
        stop = () => controls.stop()
        if (cancelled) stop()
      } catch (e) {
        setError(e instanceof Error && e.name === 'NotAllowedError' ? 'Camera permission was blocked. Allow the camera for this site and try again.' : 'No camera is available on this device.')
      }
    })()
    return () => { cancelled = true; stop?.() }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/70 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3">
          <p className="font-medium">Point the camera at a barcode</p>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close"><X className="size-4" /></button>
        </div>
        <div className="relative bg-black">
          <video ref={video} className="aspect-[4/3] w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80" />
        </div>
        <div className="px-4 py-3 text-sm">
          {error ? <p className="text-red-700">{error}</p>
            : last ? <p className="text-emerald-700">Scanned <span className="font-mono">{last}</span>{continuous ? ' — keep scanning or close' : ''}</p>
            : <p className="text-gray-500">Hold the label flat, about 6 inches away.</p>}
        </div>
      </div>
    </div>
  )
}
