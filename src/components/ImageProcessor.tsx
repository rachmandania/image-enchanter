'use client'

import { useState, useRef, useCallback } from 'react'
import { enchant, STYLES, TILE_SIZES, TTA_LEVELS, type Style } from '@/lib/enchanter'
import PixelPeep from './PixelPeep'

type Factor = 1 | 2 | 4
type Status = 'idle' | 'working' | 'done' | 'error'

const NOISE_OPTIONS = [
  { value: -1, label: 'None' },
  { value: 0, label: '0 — clean source' },
  { value: 1, label: '1 — low' },
  { value: 2, label: '2 — medium' },
  { value: 3, label: '3 — high (JPEG artifacts)' },
]

interface ImageProcessorProps {
  originalImage: string
  onReset: () => void
}

export default function ImageProcessor({ originalImage, onReset }: ImageProcessorProps) {
  const [style, setStyle] = useState<Style>('art')
  const [denoise, setDenoise] = useState(-1)
  const [factor, setFactor] = useState<Factor>(2)
  const [tta, setTta] = useState<0 | 2 | 4>(0)
  const [tileSize, setTileSize] = useState(256)
  const [tileShuffle, setTileShuffle] = useState(true)
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [zoom, setZoom] = useState(2)
  const [inputDims, setInputDims] = useState<{ w: number; h: number } | null>(null)
  const [modelUsed, setModelUsed] = useState('')
  const cancelRef = useRef(false)
  const resultUrlRef = useRef<string | null>(null)
  // Progress updates are buffered in a ref and flushed to state at most
  // every 250ms — per-tile setState on a large image re-renders the whole
  // page thousands of times and makes scrolling janky.
  const progressBuf = useRef({ done: 0, total: 0 })
  const lastFlush = useRef(0)
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushProgress = useCallback(() => {
    lastFlush.current = Date.now()
    const { done, total } = progressBuf.current
    if (total > 0) {
      setProgress(Math.round((done / total) * 100))
      setProgressLabel(`Rendering tile ${done}/${total}`)
    }
  }, [])

  const onTileProgress = useCallback(
    (done: number, total: number) => {
      progressBuf.current = { done, total }
      const since = Date.now() - lastFlush.current
      if (since >= 250) {
        flushProgress()
      } else if (!flushTimer.current) {
        flushTimer.current = setTimeout(() => {
          flushTimer.current = null
          flushProgress()
        }, 250 - since)
      }
    },
    [flushProgress],
  )

  const onModelLoad = useCallback((label: string, loaded = 0, total = 0) => {
    setProgress(0)
    if (total > 0) {
      const pct = Math.min(99, Math.round((loaded / total) * 100))
      setProgressLabel(`${label} ${pct}%`)
      setProgress(pct)
    } else {
      setProgressLabel(label)
    }
  }, [])

  const runUpscale = async () => {
    if (status === 'working') return
    cancelRef.current = false
    setStatus('working')
    setProgress(0)
    setProgressLabel('Decoding image…')
    setResultUrl(null)
    setErrorMessage('')

    try {
      // Decode to ImageData at native resolution
      const img = new Image()
      img.src = originalImage
      await img.decode()
      const w = img.naturalWidth
      const h = img.naturalHeight
      setInputDims({ w, h })

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, w, h)

      setProgressLabel('Preparing AI model…')
      const result = await enchant({
        imageData,
        style,
        denoise,
        scale: factor,
        tileSize,
        ttaLevel: tta,
        tileShuffle,
        onProgress: onTileProgress,
        onModelLoad,
        shouldCancel: () => cancelRef.current,
      })

      if (result.cancelled) {
        setStatus('idle')
        return
      }

      // Canvas -> blob URL
      const blob: Blob = await new Promise((resolve, reject) =>
        result.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
      )
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
      const url = URL.createObjectURL(blob)
      resultUrlRef.current = url
      setResultUrl(url)
      setModelUsed(result.modelUsed)
      setProgress(100)
      setStatus('done')
    } catch (err) {
      console.error(err)
      setErrorMessage(
        `Upscaling failed: ${(err as Error).message}. Try the "Photo" style for photos, or a smaller image — browser memory is limited.`,
      )
      setStatus('error')
    }
  }

  const cancel = () => {
    cancelRef.current = true
  }

  const handleDownload = () => {
    if (!resultUrl) return
    const link = document.createElement('a')
    link.href = resultUrl
    link.download = `image_enchanter_${style}_${factor}x.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const busy = status === 'working'

  return (
    <div className="max-w-5xl mx-auto">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-center gap-3 mb-6">
        {/* Style */}
        <div className="flex items-center gap-1 bg-dark-800/50 rounded-lg p-1">
          {STYLES.map((s) => (
            <button
              key={s.value}
              disabled={busy}
              onClick={() => setStyle(s.value)}
              title={s.desc}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 ${
                style === s.value ? 'bg-primary-500 text-white' : 'text-dark-300 hover:text-white'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Scale */}
        <div className="flex items-center gap-1 bg-dark-800/50 rounded-lg p-1">
          {([1, 2, 4] as Factor[]).map((f) => (
            <button
              key={f}
              disabled={busy}
              onClick={() => setFactor(f)}
              title={f === 1 ? 'Denoise only — keeps the same size' : `Upscale ${f}×`}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 ${
                factor === f ? 'bg-primary-500 text-white' : 'text-dark-300 hover:text-white'
              }`}
            >
              {f}x
            </button>
          ))}
        </div>

        {/* Denoise */}
        <select
          disabled={busy}
          value={denoise}
          onChange={(e) => setDenoise(Number(e.target.value))}
          className="bg-dark-800/50 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          <option value={-1}>No denoise</option>
          {NOISE_OPTIONS.slice(1).map((n) => (
            <option key={n.value} value={n.value}>
              Denoise {n.label}
            </option>
          ))}
        </select>

        {/* TTA */}
        <select
          disabled={busy}
          value={tta}
          onChange={(e) => setTta(Number(e.target.value) as 0 | 2 | 4)}
          title="Test-time augmentation: extra quality at a big speed cost"
          className="bg-dark-800/50 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {TTA_LEVELS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.value === 0 ? 'Quality: Fast' : `Quality: TTA${t.value}`}
            </option>
          ))}
        </select>

        {/* Tile size + shuffle (advanced) */}
        <details className="w-full text-center">
          <summary className="inline-block cursor-pointer text-dark-400 hover:text-dark-200 text-xs mb-2">
            Advanced settings
          </summary>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <select
              disabled={busy}
              value={tileSize}
              onChange={(e) => setTileSize(Number(e.target.value))}
              title="Larger tiles = faster overall but more memory. Smaller tiles for low-memory devices."
              className="bg-dark-800/50 border border-dark-600 rounded-lg px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {TILE_SIZES.map((t) => (
                <option key={t} value={t}>
                  Tile size: {t}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-dark-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={tileShuffle}
                disabled={busy}
                onChange={(e) => setTileShuffle(e.target.checked)}
                className="accent-primary-500 w-4 h-4"
              />
              Shuffle tiles
            </label>
          </div>
        </details>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
        {status !== 'working' && (
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
              onClick={handleDownload}
              className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold rounded-lg transition-colors"
            >
              ⬇ Download PNG
            </button>
            <button
              onClick={onReset}
              className="px-6 py-3 bg-dark-700 hover:bg-dark-600 text-white font-semibold rounded-lg transition-colors"
            >
              New Image
            </button>
          </>
        )}
      </div>

      {/* Progress */}
      {busy && (
        <div className="mb-8 max-w-md mx-auto bg-dark-800/50 rounded-lg p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-primary-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-white font-medium">{progressLabel}</span>
            </div>
            <span className="text-dark-300 text-sm tabular-nums">{progress}%</span>
          </div>
          <div className="w-full bg-dark-700 rounded-full h-2">
            <div
              className="bg-primary-500 h-2 rounded-full transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-dark-400 text-xs mt-3 text-center">
            AI runs entirely on your device. First run downloads the model once; later runs load instantly. Keep this tab open while it works.
          </p>
        </div>
      )}

      {status === 'error' && (
        <div className="mb-8 max-w-md mx-auto bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-center">
          <p className="text-red-300 text-sm">{errorMessage}</p>
        </div>
      )}

      {/* Result */}
      {status === 'done' && resultUrl && (
        <div className="mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <span className="text-dark-400 text-sm">Compare zoom:</span>
            {[1, 2, 4].map((z) => (
              <button
                key={z}
                onClick={() => setZoom(z)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  zoom === z ? 'bg-primary-500 text-white' : 'bg-dark-800/50 text-dark-300 hover:text-white'
                }`}
              >
                {z}x
              </button>
            ))}
          </div>

          {inputDims && (
            <p className="text-center text-dark-300 text-sm mb-4 font-medium">
              {inputDims.w}×{inputDims.h} → {inputDims.w * factor}×{inputDims.h * factor} pixels
              <span className="text-dark-500 font-normal"> · model: {modelUsed}</span>
            </p>
          )}

          {/* Pixel-peep comparison */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-3xl mx-auto mb-4">
            <PixelPeep src={originalImage} zoom={zoom} label="Original" />
            <PixelPeep src={resultUrl} zoom={zoom * factor} label={`Enhanced ${factor}x`} />
          </div>
          <p className="text-center text-dark-400 text-sm mb-6">
            Both crops show the same region — drag to explore. The enhanced side resolves sharper lines at the same zoom.
          </p>

          {/* Full result */}
          <h3 className="text-white font-medium mb-2 text-center">Full Enhanced Result</h3>
          <div className="max-w-4xl mx-auto rounded-xl overflow-hidden bg-dark-900 border border-dark-700">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={resultUrl} alt="Enhanced result" className="w-full h-auto" decoding="async" loading="lazy" />
          </div>
        </div>
      )}

      {/* Original preview while working */}
      {status !== 'done' && (
        <div className="bg-dark-800/50 rounded-2xl p-4 max-w-2xl mx-auto">
          <h3 className="text-white font-medium mb-3 text-center">Original Image</h3>
          <div className="relative max-h-[60vh] overflow-hidden rounded-xl bg-dark-900 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={originalImage} alt="Original" className="max-w-full max-h-[60vh] object-contain" decoding="async" />
          </div>
        </div>
      )}
    </div>
  )
}
