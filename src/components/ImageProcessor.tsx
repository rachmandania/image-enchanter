'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export type Quality = 'fast' | 'balanced' | 'best'
export type Factor = 2 | 4

interface ImageProcessorProps {
  originalImage: string
  onReset: () => void
}

const MAX_DIMENSION = 1200 // cap input size so WASM/WebGL inference stays reasonable
const MODEL_INFO: Record<Quality, { label: string; desc: string }> = {
  fast: { label: 'Fast', desc: 'Slim model — quickest, lighter detail' },
  balanced: { label: 'Balanced', desc: 'Medium model — good speed/quality' },
  best: { label: 'Best', desc: 'Thick model — richest detail, slowest' },
}

// Static-string dynamic imports so the bundler can code-split each model cleanly
async function loadModel(quality: Quality) {
  switch (quality) {
    case 'fast':
      return (await import('@upscalerjs/esrgan-slim/2x')).default
    case 'best':
      return (await import('@upscalerjs/esrgan-thick/2x')).default
    case 'balanced':
    default:
      return (await import('@upscalerjs/esrgan-medium/2x')).default
  }
}

export default function ImageProcessor({ originalImage, onReset }: ImageProcessorProps) {
  const [quality, setQuality] = useState<Quality>('balanced')
  const [factor, setFactor] = useState<Factor>(2)
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [resultImage, setResultImage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [compare, setCompare] = useState(50) // slider position %
  const [elapsed, setElapsed] = useState(0)
  const cancelRef = useRef(false)
  const upscalerRef = useRef<{ dispose: () => void } | null>(null)

  // Cap very large inputs before inference
  const prepareImage = useCallback(async (src: string): Promise<string> => {
    const img = new Image()
    img.src = src
    await img.decode()
    const { naturalWidth: w, naturalHeight: h } = img
    if (Math.max(w, h) <= MAX_DIMENSION) return src

    const scale = MAX_DIMENSION / Math.max(w, h)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  }, [])

  const runUpscale = useCallback(async () => {
    if (status === 'working') return
    cancelRef.current = false
    setStatus('working')
    setProgress(0)
    setProgressLabel('Preparing image…')
    setResultImage(null)
    setErrorMessage('')

    const start = Date.now()
    const ticker = setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 500)

    try {
      const prepared = await prepareImage(originalImage)

      // Lazy-load the heavy AI stack only when the user actually runs it
      setProgressLabel('Loading AI model…')
      const [{ default: Upscaler }, model] = await Promise.all([
        import('upscaler'),
        loadModel(quality),
      ])

      // Route 4x through two sequential 2x passes (models are 2x scale)
      let current: string = prepared
      const passes = factor === 4 ? 2 : 1

      const upscaler = new Upscaler({ model })
      upscalerRef.current = upscaler

      for (let pass = 0; pass < passes; pass++) {
        if (cancelRef.current) throw new Error('cancelled')
        const base = pass / passes
        const slice = 100 / passes

        const out = await upscaler.upscale(current, {
          patchSize: 64,
          padding: 2,
          progress: (amount: number) => {
            const pct = Math.round((base + amount * slice) * 100)
            setProgress(Math.min(pct, 99))
            setProgressLabel(`Pass ${pass + 1}/${passes} — ${(amount * 100).toFixed(0)}%`)
          },
          awaitNextFrame: true,
        } as never)

        if (pass < passes - 1) {
          current = out as unknown as string
        } else {
          setResultImage(out as unknown as string)
        }
      }

      // Free GPU memory once all passes are finished
      upscaler.dispose()
      upscalerRef.current = null

      setProgress(100)
      setStatus('done')
    } catch (err) {
      if ((err as Error)?.message === 'cancelled' || cancelRef.current) {
        setStatus('idle')
      } else {
        console.error(err)
        setErrorMessage(
          'Upscaling failed. Try a smaller image, or the "Fast" quality. Very large images can exhaust browser memory.'
        )
        setStatus('error')
      }
    } finally {
      clearInterval(ticker)
    }
  }, [status, quality, factor, originalImage, prepareImage])

  const cancel = () => {
    cancelRef.current = true
    upscalerRef.current?.dispose()
    upscalerRef.current = null
  }

  const handleDownload = () => {
    if (!resultImage) return
    const link = document.createElement('a')
    link.href = resultImage
    link.download = `enchanter-${factor}x-${Date.now()}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const busy = status === 'working'

  return (
    <div className="max-w-5xl mx-auto">
      {/* Controls */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
        {/* Quality selector */}
        <div className="flex items-center gap-1 bg-dark-800/50 rounded-lg p-1">
          {(Object.keys(MODEL_INFO) as Quality[]).map((q) => (
            <button
              key={q}
              disabled={busy}
              onClick={() => setQuality(q)}
              title={MODEL_INFO[q].desc}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 ${
                quality === q ? 'bg-primary-500 text-white' : 'text-dark-300 hover:text-white'
              }`}
            >
              {MODEL_INFO[q].label}
            </button>
          ))}
        </div>

        {/* Factor selector */}
        <div className="flex items-center gap-1 bg-dark-800/50 rounded-lg p-1">
          {([2, 4] as Factor[]).map((f) => (
            <button
              key={f}
              disabled={busy}
              onClick={() => setFactor(f)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 ${
                factor === f ? 'bg-primary-500 text-white' : 'text-dark-300 hover:text-white'
              }`}
            >
              {f}x Upscale
            </button>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
        {status === 'idle' && (
          <button
            onClick={runUpscale}
            className="px-6 py-3 bg-primary-500 hover:bg-primary-600 text-white font-semibold rounded-lg transition-colors"
          >
            ✨ Enhance Image
          </button>
        )}

        {busy && (
          <button
            onClick={cancel}
            className="px-6 py-3 bg-red-500/80 hover:bg-red-500 text-white font-semibold rounded-lg transition-colors"
          >
            Cancel
          </button>
        )}

        {status === 'done' && (
          <>
            <button
              onClick={runUpscale}
              className="px-6 py-3 bg-primary-500 hover:bg-primary-600 text-white font-semibold rounded-lg transition-colors"
            >
              Re-run
            </button>
            <button
              onClick={handleDownload}
              className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold rounded-lg transition-colors"
            >
              ⬇ Download Result
            </button>
            <button
              onClick={onReset}
              className="px-6 py-3 bg-dark-700 hover:bg-dark-600 text-white font-semibold rounded-lg transition-colors"
            >
              New Image
            </button>
          </>
        )}

        {status === 'error' && (
          <button
            onClick={runUpscale}
            className="px-6 py-3 bg-primary-500 hover:bg-primary-600 text-white font-semibold rounded-lg transition-colors"
          >
            Try Again
          </button>
        )}
      </div>

      {/* Progress / status */}
      {busy && (
        <div className="mb-8 max-w-md mx-auto bg-dark-800/50 rounded-lg p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-primary-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-white font-medium">{progressLabel || 'Working…'}</span>
            </div>
            <span className="text-dark-300 text-sm tabular-nums">{elapsed}s</span>
          </div>
          <div className="w-full bg-dark-700 rounded-full h-2">
            <div
              className="bg-primary-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-dark-400 text-xs mt-3 text-center">
            AI runs on your device. Keep this tab in the foreground for best speed.
          </p>
        </div>
      )}

      {status === 'error' && (
        <div className="mb-8 max-w-md mx-auto bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-center">
          <p className="text-red-300 text-sm">{errorMessage}</p>
        </div>
      )}

      {/* Result: before/after slider */}
      {status === 'done' && resultImage && (
        <div className="mb-8">
          <div className="relative w-full max-w-3xl mx-auto aspect-square bg-dark-900 rounded-xl overflow-hidden select-none">
            {/* Upscaled fills the box; original overlays clipped to slider */}
            <img src={resultImage} alt="Enhanced" className="absolute inset-0 w-full h-full object-contain" />
            <div className="absolute inset-0 overflow-hidden" style={{ width: `${compare}%` }}>
              <img
                src={originalImage}
                alt="Original"
                className="absolute inset-0 w-full h-full object-contain"
                style={{ width: '100%' }}
              />
            </div>
            {/* Divider handle */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-white/80 cursor-ew-resize"
              style={{ left: `${compare}%` }}
            >
              <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-white shadow-lg flex items-center justify-center">
                <span className="text-dark-900 text-xs font-bold">⇄</span>
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={compare}
              onChange={(e) => setCompare(Number(e.target.value))}
              className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize"
              aria-label="Compare original and enhanced"
            />
            <span className="absolute top-2 left-2 text-xs bg-black/50 text-white px-2 py-1 rounded">Original</span>
            <span className="absolute top-2 right-2 text-xs bg-black/50 text-white px-2 py-1 rounded">Enhanced {factor}x</span>
          </div>
          <p className="text-center text-dark-400 text-sm mt-3">
            Drag the slider to compare • Enhanced is {factor}x the resolution
          </p>
        </div>
      )}

      {/* Original preview while idle/working */}
      {status !== 'done' && (
        <div className="bg-dark-800/50 rounded-2xl p-4 max-w-2xl mx-auto">
          <h3 className="text-white font-medium mb-3 text-center">Original Image</h3>
          <div className="relative aspect-square overflow-hidden rounded-xl bg-dark-900">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={originalImage} alt="Original" className="w-full h-full object-contain" />
          </div>
        </div>
      )}
    </div>
  )
}
