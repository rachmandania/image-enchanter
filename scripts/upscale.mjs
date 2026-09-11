#!/usr/bin/env node
/**
 * Image Enchanter — server-side batch upscaler.
 *
 * Same engine as the web app (SwinUNet ONNX models + cumulative seam blending,
 * ported from the MIT-licensed nunif project) but running on onnxruntime-node,
 * so it can use all CPU cores with far more RAM than a browser tab.
 *
 * Usage:
 *   node scripts/upscale.mjs <input.(png|jpg|webp)> [--scale 2|4] [--denoise -1|0|1|2|3]
 *                             [--style art|art_scan|photo] [--tile 256|400|640]
 *                             [--out output.png] [--quiet]
 */
import * as ort from 'onnxruntime-node'
import sharp from 'sharp'
import path from 'node:path'
import fs from 'node:fs'

// ---------- model registry (mirrors src/lib/enchanter/config.ts) ----------
const MODEL_CDN = 'https://huggingface.co/deepghs/waifu2x_onnx/resolve/main/20230504/onnx_models'
const CACHE_DIR = path.join(process.cwd(), '.model-cache')

const SWIN_OFFSET = { 1: 8, 2: 16, 4: 32 }
const PADDING = { art: 'replication', art_scan: 'replication', photo: 'reflection' }
const COLOR_STABILITY = { art: true, art_scan: false, photo: false }

function modelPath(style, method) {
  return `${MODEL_CDN}/swin_unet/${style}/${method}.onnx`
}
function utilPath(name) {
  // 20230504 utils: only generic pad exists; named pads live locally in the repo.
  const local = path.join(process.cwd(), 'public', 'models', 'utils', `${name}.onnx`)
  if (fs.existsSync(local)) return local
  return `${MODEL_CDN}/utils/${name}.onnx`
}

const sessions = new Map()
async function session(modelRef) {
  if (!sessions.has(modelRef)) {
    const isUrl = modelRef.startsWith('http')
    let source = modelRef
    if (isUrl) {
      await fs.promises.mkdir(CACHE_DIR, { recursive: true })
      const cached = path.join(CACHE_DIR, modelRef.replaceAll('/', '__'))
      if (!fs.existsSync(cached)) {
        process.stderr.write(`[model] downloading ${path.basename(modelRef)}…\n`)
        const res = await fetch(modelRef)
        if (!res.ok) throw new Error(`download failed ${res.status}: ${modelRef}`)
        await fs.promises.writeFile(cached, Buffer.from(await res.arrayBuffer()))
      }
      source = cached
    }
    sessions.set(
      modelRef,
      await ort.InferenceSession.create(source, { executionProviders: ['cpu'], graphOptimizationLevel: 'all' }),
    )
  }
  return sessions.get(modelRef)
}

// ---------- tensor helpers ----------
function chwFromRGBA(rgba, width, height) {
  const rgb = new Float32Array(height * width * 3)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    rgb[j] = rgba[i] / 255
    rgb[j + height * width] = rgba[i + 1] / 255
    rgb[j + 2 * height * width] = rgba[i + 2] / 255
  }
  return new ort.Tensor('float32', rgb, [1, 3, height, width])
}

function crop(bchw, x, y, width, height) {
  const [, C, H, W] = bchw.dims
  const src = bchw.data
  const out = new Float32Array(C * height * width)
  let i = 0
  for (let c = 0; c < C; c++) {
    const ci = c * H * W
    for (let h = y; h < y + height; h++) {
      const hi = ci + h * W
      for (let w = x; w < x + width; w++) out[i++] = src[hi + w]
    }
  }
  return new ort.Tensor('float32', out, [1, C, height, width])
}

async function padTensor(x, left, right, top, bottom, mode) {
  const ses = await session(utilPath(`${mode}_pad`))
  const scalar = (v) => new ort.Tensor('int64', BigInt64Array.from([BigInt(v)]), [])
  const out = await ses.run({ x, left: scalar(left), right: scalar(right), top: scalar(top), bottom: scalar(bottom) })
  return out.y
}

// ---------- seam blending (port of src/lib/enchanter/seam.ts, itself from nunif) ----------
const BLEND_SIZE = 16

function calcParams(xH, xW, scale, offset, tileSize, blendSize) {
  const inputOffset = Math.ceil(offset / scale)
  const inputBlendSize = Math.ceil(blendSize / scale)
  const inputTileStep = tileSize - (inputOffset * 2 + inputBlendSize)
  const outputTileStep = inputTileStep * scale
  let [hBlocks, wBlocks, inputH, inputW] = [0, 0, 0, 0]
  while (inputH < xH + inputOffset * 2) {
    inputH = hBlocks * inputTileStep + tileSize
    hBlocks++
  }
  while (inputW < xW + inputOffset * 2) {
    inputW = wBlocks * inputTileStep + tileSize
    wBlocks++
  }
  return {
    hBlocks,
    wBlocks,
    inputTileStep,
    outputTileStep,
    bufferH: inputH * scale,
    bufferW: inputW * scale,
    pad: [inputOffset, inputW - (xW + inputOffset), inputOffset, inputH - (xH + inputOffset)],
  }
}

async function blendingFilter(scale, offset, tileSize) {
  const ses = await session(utilPath('create_seam_blending_filter'))
  const scalar = (v) => new ort.Tensor('int64', BigInt64Array.from([BigInt(v)]), [])
  const out = await ses.run({ scale: scalar(scale), offset: scalar(offset), tile_size: scalar(tileSize) })
  return out.y
}

class SeamBlender {
  constructor(bufferH, bufferW, filter) {
    this.bufferH = bufferH
    this.bufferW = bufferW
    this.filter = filter
    const [, H, W] = filter.dims
    this.fH = H
    this.fW = W
    this.pixels = new Float32Array(3 * bufferH * bufferW)
    this.weights = new Float32Array(3 * bufferH * bufferW)
    this.out = new Float32Array(filter.data.length)
  }
  update(tileY, hI, wJ) {
    const fd = this.filter.data
    const { fH, fW } = this
    const HW = fH * fW
    const bHW = this.bufferH * this.bufferW
    const fdStep = this.filterDimsStep ?? 0
    void fdStep
    for (let c = 0; c < 3; c++) {
      const cb = c * bHW
      const cf = c * HW
      for (let i = 0; i < fH; i++) {
        const bi = cb + (hI + i) * this.bufferW + wJ
        const fi = cf + i * fW
        for (let j = 0; j < fW; j++) {
          const bIdx = bi + j
          const fIdx = fi + j
          const old = this.weights[bIdx]
          const next = old + fd[fIdx]
          const oldW = old / next
          const newW = 1 - oldW
          this.pixels[bIdx] = this.pixels[bIdx] * oldW + tileY.data[fIdx] * newW
          this.weights[bIdx] += fd[fIdx]
          this.out[fIdx] = this.pixels[bIdx]
        }
      }
    }
    return this.out
  }
}

// ---------- main pipeline ----------
async function upscale(inputFile, opts) {
  const { scale, denoise, style, tileSizeReq, out, quiet } = opts
  const t0 = Date.now()
  const log = (m) => !quiet && process.stderr.write(`${m}\n`)

  const method =
    scale === 1 ? `noise${denoise}` : denoise === -1 ? `scale${scale}x` : `noise${denoise}_scale${scale}x`
  const padding = PADDING[style] ?? 'replication'
  const colorStability = COLOR_STABILITY[style] ?? true

  // SwinUNet needs tile sizes where (t-16) % 12 == 0 && (t-16) % 16 == 0
  let tileSize = tileSizeReq
  while ((tileSize - 16) % 12 !== 0 || (tileSize - 16) % 16 !== 0) tileSize++

  const raw = await sharp(inputFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H } = raw.info
  log(`[input] ${W}x${H} -> ${W * scale}x${H * scale}  (model: swin_unet/${style}/${method}, tile ${tileSize})`)

  const config = await session(modelPath(style, method))
  const offset = SWIN_OFFSET[scale]

  // RGB tensor over white; alpha handled by a parallel scale-model pass
  let x = chwFromRGBA(raw.data, W, H)
  const params = calcParams(H, W, scale, offset, tileSize, BLEND_SIZE)

  x = await padTensor(x, params.pad[0], params.pad[1], params.pad[2], params.pad[3], padding)

  const filter = await blendingFilter(scale, offset, tileSize)
  const rgbBlender = new SeamBlender(params.bufferH, params.bufferW, filter)
  // Alpha pass: reuse the same scale model on a grayscale-as-RGB tensor
  const hasAlpha = raw.data.length === H * W * 4
  let alphaBlender = null
  let alphaPadded = null
  if (hasAlpha && (scale === 1 || true)) {
    const alphaSession = await session(modelPath(style, scale === 1 ? 'scale1x' : `scale${scale}x`))
    void alphaSession
    // Build alpha3 tensor (alpha replicated to 3 channels)
    const a3 = new Float32Array(H * W * 3)
    for (let i = 0, j = 0; i < raw.data.length; i += 4, j++) {
      const a = raw.data[i + 3] / 255
      a3[j] = a
      a3[j + H * W] = a
      a3[j + 2 * H * W] = a
    }
    let alphaT = new ort.Tensor('float32', a3, [1, 3, H, W])
    alphaT = await padTensor(alphaT, params.pad[0], params.pad[1], params.pad[2], params.pad[3], padding)
    alphaBlender = new SeamBlender(params.bufferH, params.bufferW, filter)
    alphaPadded = alphaT
  }

  const allBlocks = params.hBlocks * params.wBlocks
  log(`[tiles] ${params.hBlocks}x${params.wBlocks} = ${allBlocks} tiles`)

  const outW = W * scale
  const outH = H * scale
  const outRGBA = Buffer.alloc(outW * outH * 4, 255)

  let done = 0
  let lastPct = -1
  for (let hI = 0; hI < params.hBlocks; hI++) {
    for (let wJ = 0; wJ < params.wBlocks; wJ++) {
      const i = hI * params.inputTileStep
      const j = wJ * params.inputTileStep
      const ii = hI * params.outputTileStep
      const jj = wJ * params.outputTileStep

      const tileX = crop(x, j, i, tileSize, tileSize)
      const out = await config.run({ x: tileX })
      let tileY = out.y

      let tileAlphaY = null
      if (alphaBlender && alphaPadded) {
        const tileA = crop(alphaPadded, j, i, tileSize, tileSize)
        const alphaModel = await session(modelPath(style, scale === 1 ? 'scale1x' : `scale${scale}x`))
        const aOut = await alphaModel.run({ x: tileA })
        tileAlphaY = aOut.y
      }

      const rgbView = rgbBlender.update(tileY, hI, wJ)
      // CHW view slice -> pixels
      const dims = tileY.dims
      const tw = dims[3]
      const th = dims[2]
      for (let ty = 0; ty < th; ty++) {
        const dstRow = (ii + ty) * outW + jj
        for (let tx = 0; tx < tw; tx++) {
          const src = ty * tw + tx
          const dst = (dstRow + tx) * 4
          outRGBA[dst] = Math.min(255, rgbView[src] * 255 + 0.49999)
          outRGBA[dst + 1] = Math.min(255, rgbView[src + th * tw] * 255 + 0.49999)
          outRGBA[dst + 2] = Math.min(255, rgbView[src + 2 * th * tw] * 255 + 0.49999)
          if (tileAlphaY) {
            const aData = alphaBlender.updateCache ?? null
            void aData
            outRGBA[dst + 3] = 255 // alpha written below in final pass
          }
        }
      }

      if (alphaBlender && tileAlphaY) {
        const aView = alphaBlender.update(tileAlphaY, hI, wJ)
        for (let ty = 0; ty < th; ty++) {
          const dstRow = (ii + ty) * outW + jj
          for (let tx = 0; tx < tw; tx++) {
            const src = ty * tw + tx
            const a = (aView[src] + aView[src + th * tw] + aView[src + 2 * th * tw]) / 3
            outRGBA[((dstRow + tx) * 4) + 3] = Math.min(255, a * 255 + 0.49999)
          }
        }
      }

      done++
      const pct = Math.floor((done / allBlocks) * 100)
      if (pct !== lastPct && pct % 5 === 0) {
        lastPct = pct
        log(`[progress] ${done}/${allBlocks} (${pct}%)`)
      }
    }
  }

  const outBuf = await sharp(outRGBA, { raw: { width: outW, height: outH, channels: 4 } })
    .png({ compressionLevel: 6 })
    .toBuffer()
  await fs.promises.writeFile(out, outBuf)
  log(`[done] ${out}  (${(outBuf.length / 1048576).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(1)}s)`)
}

// ---------- CLI ----------
const args = process.argv.slice(2)
const inputFile = args[0]
if (!inputFile || !fs.existsSync(inputFile)) {
  console.error(`Usage: node scripts/upscale.mjs <input.(png|jpg|webp)> [--scale 2|4] [--denoise -1|0|1|2|3] [--style art|art_scan|photo] [--tile N] [--out out.png]`)
  process.exit(1)
}
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}
await upscale(inputFile, {
  scale: Number(opt('scale', 2)),
  denoise: Number(opt('denoise', -1)),
  style: opt('style', 'art'),
  tileSizeReq: Number(opt('tile', 256)),
  out: opt('out', inputFile.replace(/\.[^.]+$/, '') + `_x${opt('scale', 2)}.png`),
  quiet: args.includes('--quiet'),
})
