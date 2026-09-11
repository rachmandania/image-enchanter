/**
 * waifu2x browser engine — public API.
 * Uses the same ONNX models as unlimited.waifu2x.net (nagadomi/nunif, MIT).
 * Everything runs client-side via onnxruntime-web. No uploads, no API keys.
 */
import * as ort from 'onnxruntime-web'
import { getConfig, type Style } from './config'
import { onnxSession } from './session'
import { waifu2xRunner } from './runner'

export { STYLES, NOISE_LEVELS } from './config'
export type { Style } from './config'

export interface Waifu2xOptions {
  imageData: ImageData
  style: Style
  denoise: number // -1 = scale only, 0..3
  scale: 1 | 2 | 4
  tileSize?: number
  onProgress?: (done: number, total: number) => void
  shouldCancel?: () => boolean
}

export interface Waifu2xResult {
  canvas: HTMLCanvasElement
  cancelled: boolean
  modelUsed: string
}

// Ensure onnxruntime finds its wasm files (copied to /public/ort)
ort.env.wasm.wasmPaths = '/ort/'
try {
  ort.env.wasm.numThreads = Math.min(navigator.hardwareConcurrency || 4, 8)
} catch {
  // non-browser env during SSR
}

export async function upscale(opts: Waifu2xOptions): Promise<Waifu2xResult> {
  const { imageData, style, denoise, scale, tileSize = 256, onProgress, shouldCancel } = opts

  const method =
    scale === 1
      ? `noise${denoise}`
      : denoise === -1
        ? `scale${scale}x`
        : `noise${denoise}_scale${scale}x`

  const config = getConfig('swin_unet', style, method)
  if (!config) throw new Error(`Model not found: swin_unet.${style}.${method}`)

  // alpha path uses the plain scale model for the alpha channel
  const alphaMethod = scale === 4 ? 'scale4x' : scale === 2 ? 'scale2x' : 'scale1x'
  const hasAlpha = checkAlphaChannel(imageData.data)
  const alphaConfig = hasAlpha ? getConfig('swin_unet', style, alphaMethod) : null

  const result = await waifu2xRunner.tiledRender({
    imageData,
    config,
    alphaConfig: alphaConfig ?? null,
    tileSize,
    onProgress,
    shouldCancel,
  })

  return {
    canvas: result.canvas,
    cancelled: result.cancelled,
    modelUsed: `swin_unet/${style}/${method}`,
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
}

export function setBackend(backend: 'auto' | 'wasm' | 'webgpu'): void {
  onnxSession.backend = backend
  onnxSession.clear()
}
