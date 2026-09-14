/**
 * Session cache + image codecs for the Image Enchanter engine.
 * ONNX models load through the persistent browser cache (download once, use forever).
 *
 * Models are handed to onnxruntime as raw ArrayBuffers. (A previous version used
 * blob URLs — those fail whenever the proxy worker is on, because a worker cannot
 * fetch a blob URL created on the main thread, which broke session creation in
 * Firefox.) Raw bytes work in both proxy and main-thread modes.
 *
 * Session creation runs in the proxy worker first (keeps the page responsive
 * during the heavy wasm compile) with a hard timeout, then falls back to the
 * main thread if the worker path fails or stalls.
 */
import * as ort from 'onnxruntime-web'
import { modelCache } from './modelCache'

// Once a proxy-worker session creation fails or times out, stop trying proxy
// mode for every later model (helpers would each burn the timeout again).
let proxyBroken = false

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

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
        // Clone before the first attempt — a worker create may detach the
        // buffer, and the main-thread fallback needs intact bytes.
        const mainThreadBytes = bytes.slice(0)

        if (!proxyBroken) {
          // Proxy worker: session creation + inference run OFF the main thread,
          // so the page (spinner, Cancel button) stays responsive during the
          // heavy wasm compile. Raw ArrayBuffer input works in worker mode.
          ort.env.wasm.proxy = true
          try {
            this.sessions[onnxPath] = await withTimeout(
              ort.InferenceSession.create(bytes, {
                logSeverityLevel: 3,
                executionProviders: ep,
              }),
              90_000,
              'AI engine setup',
            )
          } catch (proxyError) {
            console.warn('[enchanter] proxy worker unavailable, using main thread', proxyError)
            proxyBroken = true
          }
        }

        if (!(onnxPath in this.sessions)) {
          ort.env.wasm.proxy = false
          this.sessions[onnxPath] = await withTimeout(
            ort.InferenceSession.create(mainThreadBytes, {
              logSeverityLevel: 3,
              executionProviders: ep,
            }),
            150_000,
            'AI engine setup',
          )
        }
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
