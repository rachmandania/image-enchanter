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
  // Composite over white (same as the web engine): transparent pixels would
  // otherwise feed the model raw RGB garbage (usually black), producing dark
  // halos around anti-aliased edges of images with transparency.
  const rgb = new Float32Array(height * width * 3)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    const a = rgba[i + 3] / 255
    const ia = 1 - a
    rgb[j] = a * (rgba[i] / 255) + ia
    rgb[j + height * width] = a * (rgba[i + 1] / 255) + ia
    rgb[j + 2 * height * width] = a * (rgba[i + 2] / 255) + ia
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
    this.outputTileStep = 0 // set per-run by the caller
    this.pixels = new Float32Array(3 * bufferH * bufferW)
    this.weights = new Float32Array(3 * bufferH * bufferW)
    this.out = new Float32Array(filter.data.length)
  }
  /** tileI/tileJ are TILE INDICES — they are converted to buffer pixel offsets here. */
  update(tileY, tileI, tileJ) {
    const hI = tileI * this.outputTileStep
    const wJ = tileJ * this.outputTileStep
    const fd = this.filter.data
    const { fH, fW } = this
    const HW = fH * fW
    const bHW = this.bufferH * this.bufferW
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

// ---------- checkpoint/resume (lets long runs survive process timeouts) ----------
async function checkpoint(stateFile, state) {
  const dir = path.dirname(stateFile)
  await fs.promises.mkdir(dir, { recursive: true })
  const metaJson = JSON.stringify({
    ...state.meta,
    done: state.done,
    hBlocks: state.params.hBlocks,
    wBlocks: state.params.wBlocks,
    bufferH: state.params.bufferH,
    bufferW: state.params.bufferW,
  })
  const handle = await fs.promises.open(stateFile, 'w')
  await handle.writeFile(metaJson + '\n')
  await handle.write(Buffer.from(state.rgbBlender.pixels.buffer))
  await handle.write(Buffer.from(state.rgbBlender.weights.buffer))
  if (state.alphaBlender) {
    await handle.write(Buffer.from(state.alphaBlender.pixels.buffer))
    await handle.write(Buffer.from(state.alphaBlender.weights.buffer))
  }
  await handle.close()
}

async function loadCheckpoint(stateFile) {
  if (!fs.existsSync(stateFile)) return null
  try {
    const handle = await fs.promises.open(stateFile, 'r')
    const metaLine = (await handle.readFile({ length: 4096 })).toString().split('\n')[0]
    const meta = JSON.parse(metaLine)
    const headerLen = Buffer.byteLength(metaLine) + 1
    const plane = meta.bufferH * meta.bufferW * 3 * 4
    const need = meta.hasAlpha ? plane * 4 : plane * 2
    const { size } = await handle.stat()
    if (size < headerLen + need) {
      await handle.close()
      return null
    }
    const pixels = new Float32Array(plane / 4)
    const weights = new Float32Array(plane / 4)
    await handle.read(pixels, 0, plane, headerLen)
    await handle.read(weights, 0, plane, headerLen + plane)
    let alphaPixels = null
    let alphaWeights = null
    if (meta.hasAlpha) {
      alphaPixels = new Float32Array(plane / 4)
      alphaWeights = new Float32Array(plane / 4)
      await handle.read(alphaPixels, 0, plane, headerLen + plane * 2)
      await handle.read(alphaWeights, 0, plane, headerLen + plane * 3)
    }
    await handle.close()
    return { meta, pixels, weights, alphaPixels, alphaWeights }
  } catch {
    return null
  }
}

// ---------- main pipeline ----------
async function upscale(inputFile, opts) {
  const { scale, denoise, style, tileSizeReq, out, quiet, budgetSeconds, stateFile } = opts
  const t0 = Date.now()
  const log = (m) => !quiet && process.stderr.write(`${m}\n`)

  const method =
    scale === 1 ? `noise${denoise}` : denoise === -1 ? `scale${scale}x` : `noise${denoise}_scale${scale}x`
  const padding = PADDING[style] ?? 'replication'
  const colorStability = COLOR_STABILITY[style] ?? true

  // SwinUNet needs tile sizes where (t-16) % 12 == 0 && (t-16) % 16 == 0
  let tileSize = tileSizeReq
  while ((tileSize - 16) % 12 !== 0 || (tileSize - 16) % 16 !== 0) tileSize++

  const image = sharp(inputFile)
  const stats = await image.stats()
  const opaque = stats.channels.length < 4 || stats.channels[3].min === 255
  const raw = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H } = raw.info
  log(`[input] ${W}x${H} -> ${W * scale}x${H * scale}  (model: swin_unet/${style}/${method}, tile ${tileSize}${opaque ? ', opaque' : ''})`)

  const config = await session(modelPath(style, method))
  const offset = SWIN_OFFSET[scale]

  // RGB tensor over white; alpha handled by a parallel scale-model pass
  let x = chwFromRGBA(raw.data, W, H)
  const params = calcParams(H, W, scale, offset, tileSize, BLEND_SIZE)

  x = await padTensor(x, params.pad[0], params.pad[1], params.pad[2], params.pad[3], padding)

  const filter = await blendingFilter(scale, offset, tileSize)
  const rgbBlender = new SeamBlender(params.bufferH, params.bufferW, filter)
  rgbBlender.outputTileStep = params.outputTileStep
  let alphaBlender = null

  const allBlocks = params.hBlocks * params.wBlocks
  log(`[tiles] ${params.hBlocks}x${params.wBlocks} = ${allBlocks} tiles`)

  // Alpha pass: reuse the same scale model on a grayscale-as-RGB tensor.
  // Fully opaque images skip it entirely (halves the work).
  // NOTE: alphaBlender must exist BEFORE the resume block below so saved
  // alpha state is actually restored (it was previously created after, so
  // every resumed run silently restarted alpha from zero -> mostly-
  // transparent output with content only in the last-processed tiles).
  const hasAlpha = !opaque
  let alphaPadded = null
  if (hasAlpha) {
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
    alphaBlender.outputTileStep = params.outputTileStep
    alphaPadded = alphaT
  }

  let done = 0
  let lastPct = -1
  // Resume from a previous checkpoint if one exists
  const saved = stateFile ? await loadCheckpoint(stateFile) : null
  if (saved && saved.meta.method === method && saved.meta.scale === scale) {
    rgbBlender.pixels.set(saved.pixels)
    rgbBlender.weights.set(saved.weights)
    if (saved.alphaPixels && alphaBlender) {
      alphaBlender.pixels.set(saved.alphaPixels)
      alphaBlender.weights.set(saved.alphaWeights)
    } else if (saved.meta.hasAlpha && done > 0) {
      throw new Error('checkpoint has alpha state but this run has no alpha blender — delete the state file and rerun')
    }
    done = saved.meta.done
    log(`[resume] continuing from tile ${done}/${allBlocks}${saved.alphaPixels ? ' (alpha restored)' : ''}`)
  }
  for (let hI = 0; hI < params.hBlocks; hI++) {
    for (let wJ = 0; wJ < params.wBlocks; wJ++) {
      // Skip tiles already blended in a previous checkpointed run
      if (done > hI * params.wBlocks + wJ) continue
      const i = hI * params.inputTileStep
      const j = wJ * params.inputTileStep

      const tileX = crop(x, j, i, tileSize, tileSize)
      const out = await config.run({ x: tileX })
      const tileY = out.y
      rgbBlender.update(tileY, hI, wJ)

      if (alphaBlender && alphaPadded) {
        const tileA = crop(alphaPadded, j, i, tileSize, tileSize)
        const alphaModel = await session(modelPath(style, scale === 1 ? 'scale1x' : `scale${scale}x`))
        const aOut = await alphaModel.run({ x: tileA })
        alphaBlender.update(aOut.y, hI, wJ)
      }

      done++
      const pct = Math.floor((done / allBlocks) * 100)
      if (pct !== lastPct && pct % 5 === 0) {
        lastPct = pct
        log(`[progress] ${done}/${allBlocks} (${pct}%)`)
      }
      if (budgetSeconds > 0 && (Date.now() - t0) / 1000 > budgetSeconds - 20 && done < allBlocks) {
        await checkpoint(stateFile, { done, params, rgbBlender, alphaBlender, meta: { W, H, scale, style, method, tileSize, hasAlpha } })
        log(`[checkpoint] ${done}/${allBlocks} saved to ${stateFile} — rerun the same command to continue`)
        process.exit(0)
      }
    }
  }

  // Final image = TOP-LEFT crop of the blend buffer. The web engine pastes
  // tile (0,0) at buffer (0,0) and lets the canvas clip overflow, so content
  // at buffer (0,0) == image (0,0); the buffer only extends past the image
  // at the bottom/right.
  const outW = W * scale
  const outH = H * scale
  const cropX = 0
  const cropY = 0
  if (process.env.DEBUG_TILES) {
    const b = rgbBlender.pixels
    let nz = 0
    for (let q = 0; q < b.length; q++) if (Math.abs(b[q]) > 0.02) nz++
    log(`[debug] buffer nz=${(nz / b.length).toFixed(3)} bufH ${params.bufferH} bufW ${params.bufferW} outW ${outW} outH ${outH}`)
  }
  const outRGBA = Buffer.alloc(outW * outH * 4, 255)
  const bW = params.bufferW
  for (let ty = 0; ty < outH; ty++) {
    let dst = ty * outW * 4
    let src = (cropY + ty) * bW + cropX
    for (let tx = 0; tx < outW; tx++, dst += 4, src++) {
      outRGBA[dst] = Math.min(255, rgbBlender.pixels[src] * 255 + 0.49999)
      outRGBA[dst + 1] = Math.min(255, rgbBlender.pixels[src + bW * params.bufferH] * 255 + 0.49999)
      outRGBA[dst + 2] = Math.min(255, rgbBlender.pixels[src + 2 * bW * params.bufferH] * 255 + 0.49999)
      if (alphaBlender) {
        outRGBA[dst + 3] = Math.min(255,
          ((alphaBlender.pixels[src]
            + alphaBlender.pixels[src + bW * params.bufferH]
            + alphaBlender.pixels[src + 2 * bW * params.bufferH]) / 3) * 255 + 0.49999)
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
  budgetSeconds: Number(opt('budget', 0)),
  stateFile: opt('state', inputFile + '.state'),
})

