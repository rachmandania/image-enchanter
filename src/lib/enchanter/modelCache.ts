/**
 * Persistent model cache using the browser Cache API.
 * Models download once, then load from local cache on every future visit —
 * no repeat 19 MB downloads, no server round-trips.
 */
import { getHelperModelPath } from './config'

const CACHE_NAME = 'image-enchanter-models-v1'

async function openCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null // not available (older browsers)
  try {
    return await caches.open(CACHE_NAME)
  } catch {
    return null
  }
}

async function fetchWithProgress(
  url: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Response> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Model download failed: HTTP ${res.status} for ${url}`)

  if (!onProgress || !res.body) return res

  const total = Number(res.headers.get('content-length') || 0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    onProgress(loaded, total || loaded * 4) // estimate total if header missing
  }

  const blob = new Blob(chunks as BlobPart[])
  return new Response(blob, { headers: res.headers })
}

export const modelCache = {
  /** Fetch a model URL through the cache; downloads with progress on first use only. */
  async fetch(url: string, onProgress?: (loaded: number, total: number) => void): Promise<Response> {
    const cache = await openCache()
    if (cache) {
      const cached = await cache.match(url)
      if (cached) return cached
    }
    const res = await fetchWithProgress(url, onProgress)
    if (cache) {
      // Fire-and-forget: persist for future visits
      cache.put(url, res.clone()).catch(() => {})
    }
    return res
  },

  /** Pre-download a model with progress reporting (no-op if cached). */
  async prefetch(url: string, onProgress?: (loaded: number, total: number) => void): Promise<void> {
    const cache = await openCache()
    if (cache) {
      const cached = await cache.match(url)
      if (cached) {
        onProgress?.(1, 1)
        return
      }
    }
    await this.fetch(url, onProgress)
  },

  /** Resolve a model path to a same-origin cached blob URL for onnxruntime. */
  async resolve(url: string, onProgress?: (loaded: number, total: number) => void): Promise<string> {
    const res = await this.fetch(url, onProgress)
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  },

  async clear(): Promise<void> {
    const cache = await openCache()
    if (cache) await cache.delete(CACHE_NAME)
  },
}

/** All remote model URLs the app may use, for optional prewarming. */
export function knownModelUrls(arch: string, style: string): string[] {
  const urls: string[] = []
  for (const method of ['noise0_scale2x', 'noise0_scale4x']) {
    urls.push(`https://huggingface.co/deepghs/waifu2x_onnx/resolve/main/20230504/onnx_models/${arch}/${style}/${method}.onnx`)
  }
  urls.push(getHelperModelPath('create_seam_blending_filter'))
  return urls
}
