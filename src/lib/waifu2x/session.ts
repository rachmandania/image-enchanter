/**
 * Session cache + image codecs for the waifu2x browser engine.
 * Ported from nagadomi/nunif unlimited_waifu2x (utils.js), MIT License.
 */
import * as ort from 'onnxruntime-web'

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
        this.sessions[onnxPath] = await ort.InferenceSession.create(onnxPath, {
          logSeverityLevel: 3,
          executionProviders: ep,
        })
      } catch (error) {
        console.error('[waifu2x] failed to create session for', onnxPath, error)
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
