/**
 * Session cache + image codecs for the Image Enchanter engine.
 * ONNX models load through the persistent browser cache (download once, use forever).
 *
 * Inference runs through onnxruntime's built-in proxy worker (env.wasm.proxy = true,
 * set in index.ts) so heavy WASM math never blocks the main thread — the UI stays
 * responsive while tiles render. If a browser can't provide the worker, we retry
 * with proxy disabled.
 */
import * as ort from 'onnxruntime-web'
import { modelCache } from './modelCache'

export const onnxSession = {
  sessions: {} as Record<string, ort.InferenceSession>,
  backend: 'auto' as 'auto' | 'wasm' | 'webgpu',

  async getSession(onnxPath: string): Promise<ort.InferenceSession | null> {
    if (!(onnxPath in this.sessions)) {
      // WASM-first: the proxy worker requires the plain wasm EP; WebGPU is opt-in
      // via setBackend and falls back to wasm automatically.
      const ep = this.backend === 'webgpu' ? ['wasm', 'webgpu'] : ['wasm']

      try {
        // Route through the persistent cache: first run downloads (with UI progress
        // handled by the caller via prefetch), later runs load from local storage.
        const blobUrl = await modelCache.resolve(onnxPath)
        try {
          this.sessions[onnxPath] = await ort.InferenceSession.create(blobUrl, {
            logSeverityLevel: 3,
            executionProviders: ep,
          })
        } catch (proxyError) {
          console.warn('[enchanter] session creation failed, retrying without worker proxy', proxyError)
          // Proxy worker unavailable (e.g. no Worker/COOP support) — retry on main thread.
          console.warn('[enchanter] proxy session failed, retrying without worker', proxyError)
          const proxyWasEnabled = ort.env.wasm.proxy === true
          if (proxyWasEnabled) ort.env.wasm.proxy = false
          try {
            this.sessions[onnxPath] = await ort.InferenceSession.create(blobUrl, {
              logSeverityLevel: 3,
              executionProviders: ['wasm'],
            })
          } finally {
            if (proxyWasEnabled) ort.env.wasm.proxy = true
          }
        }
        URL.revokeObjectURL(blobUrl)
      } catch (error) {
        console.error('[enchanter] failed to create session for', onnxPath, error)
        return null
      }
    }
    return this.sessions[onnxPath]
  },

  clear(): void {
    for (const key of Object.keys(this.sessions)) {
      try {
        this.sessions[key]?.release()
      } catch {
        // session already released
      }
    }
    this.sessions = {}
  },
}

export function decodeImageData(img: HTMLImageElement): ImageData {
  const width = img.naturalWidth
  const height = img.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(0, 0, width, height)
}
