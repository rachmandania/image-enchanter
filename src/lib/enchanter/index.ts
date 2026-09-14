/**
 * Image Enchanter — browser AI engine, public API.
 * Runs entirely client-side via onnxruntime-web. No uploads, no API keys.
 */
import * as ort from 'onnxruntime-web'
import { getConfig, getHelperModelPath, type Style } from './config'
import { onnxSession } from './session'
import { runner } from './runner'
import { modelCache } from './modelCache'

export { STYLES, NOISE_LEVELS, TILE_SIZES, TTA_LEVELS } from './config'
export type { Style } from './config'

export interface EnchantOptions {
  imageData: ImageData
  style: Style
  denoise: number // -1 = scale only, 0..3
  scale: 1 | 2 | 4
  tileSize?: number // request; engine snaps it to a valid size for the arch
  ttaLevel?: 0 | 2 | 4
  tileShuffle?: boolean
  onProgress?: (done: number, total: number) => void
  onModelLoad?: (label: string, loaded: number, total: number) => void
  shouldCancel?: () => boolean
}

export interface EnchantResult {
  canvas: HTMLCanvasElement
  cancelled: boolean
  modelUsed: string
}

// Ensure onnxruntime finds its wasm files (copied to /public/ort)
ort.env.wasm.wasmPaths = '/ort/'
// Proxy worker (inference off the main thread) is OFF by default: combined with
// blob-URL model loading it broke session creation in Firefox. Reliability first
// — progress throttling + rAF yields already keep the UI responsive. Flip to
// true to experiment; model bytes are passed as ArrayBuffer (session.ts), which
// works in both modes.
// Proxy worker (inference off the main thread) is now managed per-attempt in
// session.ts: it enables proxy mode before each InferenceSession.create, with
// a 90s timeout and a main-thread fallback — because ort.env.wasm.proxy must
// be set BEFORE create() is called, a static value here can't do that.
// Multithreaded WASM when the page is cross-origin isolated (COOP+COEP).
try {
  if (crossOriginIsolated) {
    ort.env.wasm.numThreads = Math.min(navigator.hardwareConcurrency || 4, 8)
  }
} catch {
  // non-browser env during SSR
}

export async function enchant(opts: EnchantOptions): Promise<EnchantResult> {
  const {
    imageData,
    style,
    denoise,
    scale,
    tileSize = 256,
    ttaLevel = 0,
    tileShuffle = false,
    onProgress,
    onModelLoad,
    shouldCancel,
  } = opts

  const method =
    scale === 1
      ? `noise${denoise}`
      : denoise === -1
        ? `scale${scale}x`
        : `noise${denoise}_scale${scale}x`

  const config = getConfig('swin_unet', style, method)
  if (!config) throw new Error(`Model not found: ${style}/${method}`)

  // Wraps low-level failures with context for the UI error panel
  const fail = (e: unknown): Error => {
    const msg = e instanceof Error ? e.message : String(e)
    return new Error(`Model init failed: ${msg}`)
  }

  // alpha path uses the plain scale model for the alpha channel
  const alphaMethod = scale === 4 ? 'scale4x' : scale === 2 ? 'scale2x' : 'scale1x'
  const hasAlpha = checkAlphaChannel(imageData.data)
  const alphaConfig = hasAlpha ? getConfig('swin_unet', style, alphaMethod) : null

  // Preload every model this run needs, reporting each stage by name.
  // (Previously only the main model was prefetched — the alpha model, seam
  // filter and pad helpers loaded silently afterwards, which looked like a
  // frozen 99% bar.)
  const stage = (label: string) => onModelLoad?.(label, 0, 0)
  try {
    stage('Downloading AI model…')
    await modelCache.prefetch(config.path, (loaded, total) => {
      onModelLoad?.('Downloading AI model…', loaded, total)
    })
    if (alphaConfig) {
      stage('Downloading alpha model…')
      await modelCache.prefetch(alphaConfig.path, (loaded, total) => {
        onModelLoad?.('Downloading alpha model…', loaded, total)
      })
    }
    stage('Preparing AI engine…')
    await modelCache.prefetch(getHelperModelPath('create_seam_blending_filter'))
    await modelCache.prefetch(
      getHelperModelPath(config.padding === 'reflection' ? 'reflection_pad' : 'replication_pad'),
    )
    if (hasAlpha) {
      await modelCache.prefetch(getHelperModelPath('alpha_border_padding'))
    }
  } catch (e) {
    throw fail(e)
  }

  try {
    const result = await runner.tiledRender({
      imageData,
      config,
      alphaConfig: alphaConfig ?? null,
      tileSize,
      ttaLevel,
      tileShuffle,
      onProgress,
      shouldCancel,
    })

    return {
      canvas: result.canvas,
      cancelled: result.cancelled,
      modelUsed: `${style}/${method}${ttaLevel > 0 ? ` (TTA${ttaLevel})` : ''}`,
    }
  } catch (e) {
    throw fail(e)
  }
}

export function checkAlphaChannel(rgba: Uint8ClampedArray): boolean {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 255) return true
  }
  return false
}

export function clearModelCache(): void {
  onnxSession.clear()
  modelCache.clear()
}

export function setBackend(backend: 'auto' | 'wasm' | 'webgpu'): void {
  onnxSession.backend = backend
  onnxSession.clear()
}
