/**
 * Session cache + image codecs for the Image Enchanter engine.
 * ONNX models load through the persistent browser cache (download once, use forever).
 */
import * as ort from 'onnxruntime-web'
import { modelCache } from './modelCache'

export const onnxSession = {
  sessions: {} as Record<string, ort.InferenceSession>,
  backend: 'auto' as 'auto' | 'wasm' | 'webgpu',

  async getSession(onnxPath: string): Promise<ort.InferenceSession | null> {
    if (!(onnxPath in this.sessions)) {
      let ep: string[]
      if (this.backend === 'webgpu') {
        ep = ['webgpu']
      } else if (this.backend === 'wasm') {
        ep = ['wasm']
      } else {
        // webgpu if available, wasm fallback
        ep = ['webgpu', 'wasm']
      }
      try {
        // Route through the persistent cache: first run downloads (with UI progress
        // handled by the caller via prefetch), later runs load from local storage.
        const blobUrl = await modelCache.resolve(onnxPath)
        this.sessions[onnxPath] = await ort.InferenceSession.create(blobUrl, {
          logSeverityLevel: 3,
          executionProviders: ep,
        })
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
      this.sessions[key].release()
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
