'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BRAND } from '@/lib/brand'
import {
  loadImage,
  stitch,
  formatBytes,
  downloadResult,
  type SourceImage,
  type StitchOptions,
  type StitchResult,
  type StitchMode,
  type OutputFormat,
  type PdfLayout,
} from '@/lib/stitch'

const MODES: {
  value: StitchMode
  label: string
  desc: string
  icon: string
}[] = [
  {
    value: 'horizontal',
    label: 'Side by side',
    desc: 'Pages 1 & 2 of one document, next to each other',
    icon: '⇤⇥',
  },
  {
    value: 'vertical',
    label: 'Stacked',
    desc: 'Long receipts, chat threads, multi-page lists',
    icon: '⤒⤓',
  },
  {
    value: 'convert',
    label: 'Convert only',
    desc: 'Change the file type without joining anything',
    icon: '⇄',
  },
]

const FORMATS: { value: OutputFormat; label: string }[] = [
  { value: 'jpg', label: 'JPG' },
  { value: 'png', label: 'PNG' },
  { value: 'pdf', label: 'PDF' },
]

const PDF_LAYOUTS: {
  value: PdfLayout
  label: string
  desc: string
}[] = [
  {
    value: 'stitched',
    label: 'One page',
    desc: 'Images joined into a single PDF page',
  },
  {
    value: 'multipage',
    label: 'One page per image',
    desc: 'A normal multi-page PDF document',
  },
]

const ALIGNS: { value: 'start' | 'center' | 'end'; label: string }[] = [
  { value: 'start', label: 'Top / Left' },
  { value: 'center', label: 'Center' },
  { value: 'end', label: 'Bottom / Right' },
]

const BACKGROUNDS: {
  value: 'white' | 'black' | 'transparent'
  label: string
  swatch: string
}[] = [
  { value: 'white', label: 'White', swatch: 'bg-white' },
  { value: 'black', label: 'Black', swatch: 'bg-black' },
  { value: 'transparent', label: 'None', swatch: 'bg-checker' },
]

export default function DocClipper() {
  const [items, setItems] = useState<SourceImage[]>([])
  const [opts, setOpts] = useState<StitchOptions>({
    mode: 'horizontal',
    format: 'pdf',
    pdfLayout: 'stitched',
    align: 'start',
    spacing: 0,
    background: 'white',
  })
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [proceeding, setProceeding] = useState(false)
  const [result, setResult] = useState<StitchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const loadedImages = useRef(new Map<string, HTMLImageElement>())
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (list.length === 0) {
      setError('Please choose image files (JPG, PNG, WebP…)')
      return
    }
    setError(null)
    const added: SourceImage[] = []
    for (const file of list) {
      try {
        const { img, url } = await loadImage(file)
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        loadedImages.current.set(id, img)
        added.push({
          id,
          file,
          url,
          width: img.naturalWidth,
          height: img.naturalHeight,
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not read a file')
      }
    }
    if (added.length > 0) setItems((prev) => [...prev, ...added])
  }, [])

  const removeItem = useCallback((id: string) => {
    setItems((prev) => {
      const item = prev.find((i) => i.id === id)
      if (item) {
        URL.revokeObjectURL(item.url)
        loadedImages.current.delete(id)
      }
      return prev.filter((i) => i.id !== id)
    })
  }, [])

  const moveItem = useCallback((index: number, dir: -1 | 1) => {
    setItems((prev) => {
      const next = [...prev]
      const target = index + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }, [])

  // Rules: joining needs 2+ images; convert takes 1+ (PDF stacks pages,
  // JPG/PNG falls back to the first image with a visible warning).
  const needsMore =
    opts.mode !== 'convert' && items.length > 0 && items.length < 2
  const canProceed = opts.mode === 'convert' ? items.length >= 1 : items.length >= 2
  // Page order matters in convert mode only when several images become PDF pages.
  const showOrder =
    opts.mode !== 'convert' || (opts.format === 'pdf' && items.length > 1)

  const proceed = useCallback(async () => {
    if (!canProceed) return
    setProceeding(true)
    setError(null)
    try {
      const ordered = items
        .map((i) => loadedImages.current.get(i.id))
        .filter((img): img is HTMLImageElement => Boolean(img))
      const output: StitchOptions =
        opts.mode === 'convert' ? { ...opts, mode: 'convert' } : opts
      const res = await stitch(ordered, output)
      setResult((prev) => {
        if (prev) URL.revokeObjectURL(prev.url)
        return res
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setProceeding(false)
    }
  }, [items, opts, canProceed])

  const reset = useCallback(() => {
    setResult((prev) => {
      if (prev) URL.revokeObjectURL(prev.url)
      return null
    })
    setError(null)
  }, [])

  // Convert mode ignores order — keep the hint accurate.
  useEffect(() => {
    if (opts.mode === 'convert' && result) reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.mode])

  const baseName = items[0]
    ? items[0].file.name.replace(/\.[^.]+$/, '')
    : 'document'

  const moveLabels =
    opts.mode === 'horizontal' ? ['◀', '▶'] : ['▲', '▼']

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Step 1 — mode */}
      <section className="bg-dark-800/50 border border-dark-700/50 rounded-2xl p-5">
        <p className="text-sm font-semibold text-white mb-1">
          <span className="text-primary-400 mr-2">①</span>What do you want to
          do?
        </p>
        <div className="grid gap-2 sm:grid-cols-3 mt-3">
          {MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => {
                setOpts((o) => ({ ...o, mode: m.value }))
                reset()
              }}
              className={`text-left rounded-xl border px-4 py-3 transition-colors ${
                opts.mode === m.value
                  ? 'border-primary-500 bg-primary-500/15'
                  : 'border-dark-600 hover:border-dark-500'
              }`}
            >
              <span className="text-lg text-primary-400">{m.icon}</span>
              <p className="text-sm font-medium text-white mt-1">{m.label}</p>
              <p className="text-xs text-dark-400 mt-0.5">{m.desc}</p>
            </button>
          ))}
        </div>
      </section>

      {/* Step 2 — output format */}
      <section className="bg-dark-800/50 border border-dark-700/50 rounded-2xl p-5">
        <p className="text-sm font-semibold text-white mb-1">
          <span className="text-primary-400 mr-2">②</span>Result file type
        </p>
        <div className="grid grid-cols-3 gap-2 mt-3 max-w-md">
          {FORMATS.map((f) => (
            <button
              key={f.value}
              onClick={() => {
                setOpts((o) => ({ ...o, format: f.value }))
                reset()
              }}
              className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                opts.format === f.value
                  ? 'border-primary-500 bg-primary-500/15 text-white'
                  : 'border-dark-600 text-dark-300 hover:border-dark-500'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {opts.format === 'pdf' && opts.mode !== 'convert' && (
          <div className="mt-4">
            <p className="text-xs uppercase tracking-wider text-dark-400 mb-2">
              PDF layout
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {PDF_LAYOUTS.map((p) => (
                <button
                  key={p.value}
                  onClick={() =>
                    setOpts((o) => ({ ...o, pdfLayout: p.value }))
                  }
                  className={`text-left rounded-xl border px-4 py-3 transition-colors ${
                    opts.pdfLayout === p.value
                      ? 'border-primary-500 bg-primary-500/15'
                      : 'border-dark-600 hover:border-dark-500'
                  }`}
                >
                  <p className="text-sm font-medium text-white">{p.label}</p>
                  <p className="text-xs text-dark-400 mt-0.5">{p.desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {opts.mode === 'convert' && (
          <p className="text-xs text-dark-400 mt-3">
            {opts.format === 'pdf'
              ? items.length <= 1
                ? 'One image becomes a one-page PDF. Add more images and each one becomes its own page, in the order above.'
                : `${items.length} images → one PDF with ${items.length} pages, one page per image in the order above.`
              : items.length > 1
                ? 'JPG/PNG files can’t hold multiple pages — only the first image will be converted. For several images at once, choose PDF, or use a join mode.'
                : 'One image in, one converted image out.'}
          </p>
        )}
      </section>

      {/* Step 3 — files */}
      <section className="bg-dark-800/50 border border-dark-700/50 rounded-2xl p-5">
        <p className="text-sm font-semibold text-white mb-1">
          <span className="text-primary-400 mr-2">③</span>
          {opts.mode === 'convert'
            ? opts.format === 'pdf'
              ? 'Add the image(s) to convert'
              : 'Add the image to convert'
            : 'Add your pages (2 or more)'}
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={(e) => {
            e.preventDefault()
            setIsDragging(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setIsDragging(false)
            if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files)
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`mt-3 border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
            isDragging
              ? 'border-primary-400 bg-primary-400/10'
              : 'border-dark-600 hover:border-primary-500 hover:bg-dark-800/50'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files)
              e.target.value = ''
            }}
            className="hidden"
          />
          <p className="text-white font-medium">
            Drop images here or{' '}
            <span className="text-primary-400">click to browse</span>
          </p>
          <p className="text-xs text-dark-500 mt-1">
            JPG · PNG · WebP — everything stays on your device
          </p>
        </div>

        {items.length > 0 && (
          <div className="mt-4 space-y-2">
            {showOrder && (
              <p className="text-xs text-dark-400">
                Order:{' '}
                {opts.mode === 'vertical'
                  ? 'top → bottom'
                  : opts.mode === 'horizontal'
                    ? 'left → right'
                    : `page 1 → page ${items.length}`}
              </p>
            )}
            {items.map((item, index) => (
              <div
                key={item.id}
                className="flex items-center gap-3 bg-dark-900/60 border border-dark-700/50 rounded-xl p-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.url}
                  alt={item.file.name}
                  className="w-12 h-12 rounded-lg object-cover bg-dark-800 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white truncate">{item.file.name}</p>
                  <p className="text-xs text-dark-400">
                    {item.width} × {item.height} · {formatBytes(item.file.size)}
                  </p>
                </div>
                {showOrder && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => moveItem(index, -1)}
                      disabled={index === 0}
                      className="w-8 h-8 rounded-lg text-dark-300 hover:bg-dark-700 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                      aria-label="Move earlier"
                    >
                      {moveLabels[0]}
                    </button>
                    <button
                      onClick={() => moveItem(index, 1)}
                      disabled={index === items.length - 1}
                      className="w-8 h-8 rounded-lg text-dark-300 hover:bg-dark-700 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                      aria-label="Move later"
                    >
                      {moveLabels[1]}
                    </button>
                  </div>
                )}
                <button
                  onClick={() => removeItem(item.id)}
                  className="w-8 h-8 rounded-lg text-dark-400 hover:bg-red-500/20 hover:text-red-300 transition-colors shrink-0"
                  aria-label="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Advanced */}
      {opts.mode !== 'convert' && items.length > 0 && (
        <div className="bg-dark-800/50 border border-dark-700/50 rounded-2xl">
          <button
            onClick={() => setShowAdvanced((s) => !s)}
            className="w-full flex items-center justify-between px-5 py-3 text-sm text-dark-300 hover:text-white transition-colors"
          >
            <span>⚙ Advanced layout options</span>
            <span>{showAdvanced ? '−' : '+'}</span>
          </button>
          {showAdvanced && (
            <div className="px-5 pb-5 grid gap-5 sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-dark-400 mb-2">
                  Alignment
                </p>
                <div className="grid grid-cols-1 gap-2">
                  {ALIGNS.map((a) => (
                    <button
                      key={a.value}
                      onClick={() =>
                        setOpts((o) => ({ ...o, align: a.value }))
                      }
                      className={`rounded-xl border px-3 py-2 text-xs transition-colors ${
                        opts.align === a.value
                          ? 'border-primary-500 bg-primary-500/15 text-white'
                          : 'border-dark-600 text-dark-300 hover:border-dark-500'
                      }`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-dark-400 mb-2">
                  Gap — {opts.spacing}px
                </p>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={opts.spacing}
                  onChange={(e) =>
                    setOpts((o) => ({
                      ...o,
                      spacing: Number(e.target.value),
                    }))
                  }
                  className="w-full accent-[#0ea5e9] mt-3"
                />
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-dark-400 mb-2">
                  Background
                </p>
                <div className="grid grid-cols-1 gap-2">
                  {BACKGROUNDS.map((b) => (
                    <button
                      key={b.value}
                      onClick={() =>
                        setOpts((o) => ({ ...o, background: b.value }))
                      }
                      className={`rounded-xl border px-3 py-2 text-xs flex items-center gap-2 transition-colors ${
                        opts.background === b.value
                          ? 'border-primary-500 bg-primary-500/15 text-white'
                          : 'border-dark-600 text-dark-300 hover:border-dark-500'
                      }`}
                    >
                      <span
                        className={`inline-block w-3 h-3 rounded-sm ${b.swatch} border border-dark-500`}
                      />
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 4 — proceed */}
      <div className="text-center space-y-2">
        <button
          onClick={proceed}
          disabled={!canProceed || proceeding}
          className="rounded-xl bg-primary-500 hover:bg-primary-400 disabled:opacity-40 disabled:hover:bg-primary-500 text-white font-semibold px-10 py-3 text-base transition-colors shadow-lg shadow-primary-500/20"
        >
          {proceeding ? 'Working…' : '▶ Proceed'}
        </button>
        <p className="text-xs text-dark-500">
          {items.length === 0
            ? 'Add at least one image to continue'
            : needsMore
              ? 'Joining needs 2 or more images — add one more, or switch to Convert only'
              : canProceed
                ? 'Runs instantly in your browser — nothing is uploaded'
                : ''}
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <section className="bg-dark-800/50 border border-primary-500/30 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-sm font-semibold text-white">
                {result.kind === 'pdf'
                  ? `PDF ready — ${result.pages} page${result.pages > 1 ? 's' : ''}`
                  : `Image ready — ${result.width} × ${result.height}`}
              </p>
              <p className="text-xs text-dark-400 mt-0.5">
                {formatBytes(result.blob.size)} ·{' '}
                {result.kind === 'pdf'
                  ? 'preview shows page 1'
                  : 'this is the exact file you download'}
              </p>
            </div>
            <button
              onClick={() => downloadResult(result, `${baseName}-joined`)}
              className="rounded-xl bg-primary-500 hover:bg-primary-400 text-white font-semibold px-5 py-2.5 text-sm transition-colors shadow-lg shadow-primary-500/20"
            >
              ⬇ Download {result.kind === 'pdf' ? 'PDF' : result.ext.toUpperCase()}
            </button>
          </div>
          <div className="rounded-xl overflow-auto max-h-[60vh] bg-dark-900 border border-dark-700/50">
            {result.kind === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={result.url}
                alt="Result"
                className="max-w-full h-auto mx-auto block"
              />
            ) : result.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={result.previewUrl}
                alt="PDF page 1 preview"
                className="max-w-full h-auto mx-auto block"
              />
            ) : null}
          </div>
        </section>
      )}

      <p className="text-center text-xs text-dark-500">
        {BRAND.name} never uploads your files — joining and conversion happen
        entirely in your browser.
      </p>
    </div>
  )
}
