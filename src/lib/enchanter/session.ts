/**
 * Session cache + image codecs for the Image Enchanter engine.
 * ONNX models load through the persistent browser cache (download once, use forever).
 *
 * Models are handed to onnxruntime as raw ArrayBuffers. (A previous version used
 * blob URLs — those fail whenever the proxy worker is on, because a worker cannot
 * fetch a blob URL created on the main thread, which broke session creation in
 * Firefox.) Raw bytes work in both proxy and main-thread modes.
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
        const res = await modelCache.fetch(onnxPath)
        const bytes = await res.arrayBuffer()
        this.sessions[onnxPath] = await ort.InferenceSession.create(bytes, {
          logSeverityLevel: 3,
          executionProviders: ep,
        })
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
