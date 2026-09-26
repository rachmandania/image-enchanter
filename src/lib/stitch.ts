import { jsPDF } from 'jspdf'

export type Direction = 'horizontal' | 'vertical'
export type StitchMode = Direction | 'convert'
export type OutputFormat = 'jpg' | 'png' | 'pdf'
export type PdfLayout = 'stitched' | 'multipage'
export type Align = 'start' | 'center' | 'end'
export type Background = 'white' | 'black' | 'transparent'

export interface SourceImage {
  id: string
  file: File
  url: string
  width: number
  height: number
}

export interface StitchOptions {
  mode: StitchMode
  format: OutputFormat
  pdfLayout: PdfLayout
  align: Align
  spacing: number
  background: Background
}

export type StitchResult =
  | {
      kind: 'image'
      blob: Blob
      url: string
      width: number
      height: number
      ext: 'jpg' | 'png'
    }
  | {
      kind: 'pdf'
      blob: Blob
      url: string
      pages: number
      previewUrl: string | null
    }

/** Load a File into an HTMLImageElement and report its natural size. */
export function loadImage(
  file: File
): Promise<{ img: HTMLImageElement; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve({ img, url })
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`Could not read "${file.name}" as an image`))
    }
    img.src = url
  })
}

export function computeCanvasSize(
  images: Pick<HTMLImageElement, 'width' | 'height'>[],
  direction: Direction,
  spacing: number
): { width: number; height: number } {
  const gap = Math.max(0, Math.round(spacing))
  const horizontal = direction === 'horizontal'
  const mainTotal =
    images.reduce(
      (sum, img) => sum + (horizontal ? img.width : img.height),
      0
    ) +
    gap * Math.max(0, images.length - 1)
  const cross = Math.max(
    ...images.map((img) => (horizontal ? img.height : img.width))
  )
  return {
    width: horizontal ? mainTotal : cross,
    height: horizontal ? cross : mainTotal,
  }
}

const BG_COLORS: Record<Exclude<Background, 'transparent'>, string> = {
  white: '#ffffff',
  black: '#000000',
}

/**
 * Draw all images onto one canvas.
 * Horizontal: images left→right, canvas height = tallest image.
 * Vertical: images top→bottom, canvas width = widest image.
 * `flattenToWhite` forces a white background (JPEG/PDF have no alpha).
 */
export function renderJoin(
  images: HTMLImageElement[],
  opts: Pick<StitchOptions, 'mode' | 'align' | 'spacing' | 'background'>,
  flattenToWhite: boolean
): HTMLCanvasElement {
  if (images.length === 0) throw new Error('No images to stitch')
  const direction: Direction =
    opts.mode === 'vertical' ? 'vertical' : 'horizontal'
  const { width, height } = computeCanvasSize(images, direction, opts.spacing)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create a drawing canvas')

  const bg =
    flattenToWhite && opts.background === 'transparent'
      ? BG_COLORS.white
      : opts.background === 'transparent'
        ? null
        : BG_COLORS[opts.background]
  if (bg) {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, width, height)
  }

  const horizontal = direction === 'horizontal'
  const gap = Math.max(0, Math.round(opts.spacing))
  const cross = horizontal ? height : width

  let offset = 0
  for (const img of images) {
    const mainSize = horizontal ? img.width : img.height
    const crossSize = horizontal ? img.height : img.width
    const crossOffset =
      opts.align === 'start'
        ? 0
        : opts.align === 'center'
          ? (cross - crossSize) / 2
          : cross - crossSize
    const x = horizontal ? offset : crossOffset
    const y = horizontal ? crossOffset : offset
    ctx.drawImage(img, Math.round(x), Math.round(y))
    offset += mainSize + gap
  }

  return canvas
}

/** Draw one image (or canvas) onto a white background as a JPEG data URL. */
function toJpegDataUrl(
  source: HTMLImageElement | HTMLCanvasElement
): string {
  const w =
    source instanceof HTMLCanvasElement ? source.width : source.naturalWidth
  const h =
    source instanceof HTMLCanvasElement
      ? source.height
      : source.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create a drawing canvas')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(source, 0, 0)
  return canvas.toDataURL('image/jpeg', 0.92)
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: 'jpg' | 'png'
): Promise<Blob> {
  const type = format === 'png' ? 'image/png' : 'image/jpeg'
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(
              new Error(
                'The result is too large for this browser. Try fewer images.'
              )
            ),
      type,
      0.92
    )
  })
}

function makeDoc(width: number, height: number): jsPDF {
  return new jsPDF({
    orientation: width > height ? 'landscape' : 'portrait',
    unit: 'px',
    format: [width, height],
    hotfixes: ['px_scaling'],
  })
}

/** One PDF page containing the stitched image. */
function buildStitchedPdf(
  images: HTMLImageElement[],
  opts: StitchOptions
): { doc: jsPDF; previewUrl: string } {
  const canvas = renderJoin(images, opts, true)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
  const doc = makeDoc(canvas.width, canvas.height)
  doc.addImage(dataUrl, 'JPEG', 0, 0, canvas.width, canvas.height)
  return { doc, previewUrl: dataUrl }
}

/** One PDF page per image, each page sized to that image. */
function buildMultipagePdf(images: HTMLImageElement[]): {
  doc: jsPDF
  previewUrl: string
} {
  let doc: jsPDF | null = null
  for (const img of images) {
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!doc) {
      doc = makeDoc(w, h)
    } else {
      doc.addPage([w, h], w > h ? 'landscape' : 'portrait')
    }
    doc.addImage(toJpegDataUrl(img), 'JPEG', 0, 0, w, h)
  }
  if (!doc) throw new Error('No images to stitch')
  return { doc, previewUrl: toJpegDataUrl(images[0]) }
}

/** Convert a single image to the chosen raster format. */
async function convertSingle(
  img: HTMLImageElement,
  format: 'jpg' | 'png'
): Promise<StitchResult> {
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create a drawing canvas')
  if (format === 'jpg') {
    // JPEG has no alpha channel — flatten onto white so it doesn't turn black.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.drawImage(img, 0, 0)
  const blob = await canvasToBlob(canvas, format)
  return {
    kind: 'image',
    blob,
    url: URL.createObjectURL(blob),
    width: canvas.width,
    height: canvas.height,
    ext: format,
  }
}

/**
 * Top-level engine: takes loaded images + options, returns a downloadable
 * result (raster blob or PDF blob). Everything runs in the browser.
 */
export async function stitch(
  images: HTMLImageElement[],
  opts: StitchOptions
): Promise<StitchResult> {
  if (images.length === 0) throw new Error('Add at least one image')

  if (opts.mode === 'convert') {
    if (opts.format === 'pdf') {
      // One page per image: 1 file → 1-page PDF, N files → N-page PDF.
      const { doc, previewUrl } = buildMultipagePdf(images)
      const blob = doc.output('blob')
      return {
        kind: 'pdf',
        blob,
        url: URL.createObjectURL(blob),
        pages: images.length,
        previewUrl,
      }
    }
    return convertSingle(images[0], opts.format)
  }

  if (opts.format === 'pdf') {
    const { doc, previewUrl } =
      opts.pdfLayout === 'multipage'
        ? buildMultipagePdf(images)
        : buildStitchedPdf(images, opts)
    const blob = doc.output('blob')
    return {
      kind: 'pdf',
      blob,
      url: URL.createObjectURL(blob),
      pages: opts.pdfLayout === 'multipage' ? images.length : 1,
      previewUrl,
    }
  }

  // JPG / PNG join
  const canvas = renderJoin(images, opts, opts.format === 'jpg')
  const blob = await canvasToBlob(canvas, opts.format)
  return {
    kind: 'image',
    blob,
    url: URL.createObjectURL(blob),
    width: canvas.width,
    height: canvas.height,
    ext: opts.format,
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function downloadResult(result: StitchResult, baseName: string) {
  const ext = result.kind === 'pdf' ? 'pdf' : result.ext
  const a = document.createElement('a')
  a.href = result.url
  a.download = `${baseName}.${ext}`
  a.click()
}
