/**
 * Tiled ONNX inference engine for Image Enchanter.
 * Derived from the MIT-licensed nunif tiled-rendering approach.
 */
import * as ort from 'onnxruntime-web'
import { getConfig, getHelperModelPath, type ModelConfig } from './config'
import { onnxSession } from './session'
import { SeamBlending } from './seam'

export interface TiledRenderOptions {
  imageData: ImageData
  config: ModelConfig
  alphaConfig: ModelConfig | null
  tileSize: number
  onProgress?: (done: number, total: number) => void
  shouldCancel?: () => boolean
}

export interface TiledRenderResult {
  canvas: HTMLCanvasElement
  cancelled: boolean
}

export const runner = {
  async tiledRender(opts: TiledRenderOptions): Promise<TiledRenderResult> {
    const { imageData, config, alphaConfig, tileSize, onProgress, shouldCancel } = opts

    const hasAlpha = alphaConfig !== null
    const model = await onnxSession.getSession(config.path)
    if (!model) throw new Error('Failed to load upscaling model')

    let alphaModel: ort.InferenceSession | null = null
    if (hasAlpha) {
      alphaModel = await onnxSession.getSession(alphaConfig.path)
      if (!alphaModel) throw new Error('Failed to load alpha model')
    }

    // preprocess: RGBA -> CHW float tensor
    let x = this.toInput(imageData.data, imageData.width, imageData.height)
    let alpha3: ort.Tensor | null = null

    let seamBlending: SeamBlending
    let seamBlendingAlpha: SeamBlending | null = null
    let p

    if (hasAlpha) {
      // Split RGB + alpha — keep_alpha path
      const rgbArr = new Float32Array(imageData.height * imageData.width * 3)
      const alpha1 = new Float32Array(imageData.height * imageData.width)
      const alpha3Arr = new Float32Array(imageData.height * imageData.width * 3)
      const { width, height } = imageData
      for (let y = 0; y < height; ++y) {
        for (let px = 0; px < width; ++px) {
          const i = (y * width + px) * 4
          const j = y * width + px
          rgbArr[j] = imageData.data[i] / 255.0
          rgbArr[j + height * width] = imageData.data[i + 1] / 255.0
          rgbArr[j + 2 * height * width] = imageData.data[i + 2] / 255.0
          const a = imageData.data[i + 3] / 255.0
          alpha1[j] = a
          alpha3Arr[j] = a
          alpha3Arr[j + height * width] = a
          alpha3Arr[j + 2 * height * width] = a
        }
      }
      const rgb = new ort.Tensor('float32', rgbArr, [1, 3, height, width])
      const alpha1T = new ort.Tensor('float32', alpha1, [1, 1, height, width])
      alpha3 = new ort.Tensor('float32', alpha3Arr, [1, 3, height, width])

      seamBlending = new SeamBlending(rgb.dims as [number, number, number, number], config.scale, config.offset, tileSize)
      seamBlendingAlpha = new SeamBlending(alpha3.dims as [number, number, number, number], config.scale, config.offset, tileSize)
      await seamBlendingAlpha.build()
      await seamBlending.build()
      p = seamBlending.getRenderingConfig()

      x = await this.alphaBorderPadding(rgb, alpha1T, config.offset)
      x = await this.padding(x, p.pad[0], p.pad[1], p.pad[2], p.pad[3], config.padding)
      alpha3 = await this.padding(alpha3, p.pad[0], p.pad[1], p.pad[2], p.pad[3], config.padding)
    } else {
      alpha3 = null
      seamBlending = new SeamBlending(x.dims as [number, number, number, number], config.scale, config.offset, tileSize)
      await seamBlending.build()
      p = seamBlending.getRenderingConfig()
      x = await this.padding(x, p.pad[0], p.pad[1], p.pad[2], p.pad[3], config.padding)
    }

    const allBlocks = p.h_blocks * p.w_blocks

    // Build output canvas
    const canvas = document.createElement('canvas')
    canvas.width = imageData.width * config.scale
    canvas.height = imageData.height * config.scale
    const outputCtx = canvas.getContext('2d', { willReadFrequently: true })!

    // tile indices
    const tiles: [number, number, number, number, number, number][] = []
    for (let hI = 0; hI < p.h_blocks; ++hI) {
      for (let wJ = 0; wJ < p.w_blocks; ++wJ) {
        const i = hI * p.input_tile_step
        const j = wJ * p.input_tile_step
        const ii = hI * p.output_tile_step
        const jj = wJ * p.output_tile_step
        tiles.push([i, j, ii, jj, hI, wJ])
      }
    }

    onProgress?.(0, allBlocks)

    let progress = 0
    for (const [i, j, ii, jj, hI, wJ] of tiles) {
      if (shouldCancel?.()) {
        return { canvas, cancelled: true }
      }

      const tileX = this.cropTensor(x, j, i, tileSize, tileSize)
      let tileAlpha3: ort.Tensor | null = null
      if (hasAlpha && alpha3) {
        tileAlpha3 = this.cropTensor(alpha3, j, i, tileSize, tileSize)
      }

      const singleColor = config.color_stability
        ? this.checkSingleColor(tileX, tileAlpha3)
        : null

      let tileY: ort.Tensor
      let tileAlphaY: ort.Tensor | null = null

      if (singleColor === null) {
        const rgbOut = await model.run({ x: tileX })
        tileY = rgbOut.y
        if (hasAlpha && alphaModel && tileAlpha3) {
          const alphaOut = await alphaModel.run({ x: tileAlpha3 })
          tileAlphaY = alphaOut.y
        }
      } else {
        // single-color tile: skip inference entirely
        const size = tileSize * config.scale - config.offset * 2
        const [c, a] = this.createSingleColorTensor(singleColor, size)
        tileY = c
        tileAlphaY = a
      }

      let outputImageData: ImageData
      if (hasAlpha && tileAlphaY && seamBlendingAlpha) {
        const rgb = seamBlending.update(tileY, hI, wJ)
        const alpha = seamBlendingAlpha.update(tileAlphaY, hI, wJ)
        outputImageData = this.toImageData(rgb.data as Float32Array, alpha.data as Float32Array, tileY.dims[3], tileY.dims[2])
      } else {
        const rgb = seamBlending.update(tileY, hI, wJ)
        outputImageData = this.toImageData(rgb.data as Float32Array, null, tileY.dims[3], tileY.dims[2])
      }
      outputCtx.putImageData(outputImageData, jj, ii)

      ++progress
      onProgress?.(progress, allBlocks)
    }

    return { canvas, cancelled: false }
  },

  toInput(rgba: Uint8ClampedArray, width: number, height: number): ort.Tensor {
    // HWC RGBA -> CHW float32, alpha composited over white
    const rgb = new Float32Array(height * width * 3)
    const bgColor = 1.0
    for (let y = 0; y < height; ++y) {
      for (let x = 0; x < width; ++x) {
        const alpha = rgba[(y * width + x) * 4 + 3] / 255.0
        for (let c = 0; c < 3; ++c) {
          const i = (y * width + x) * 4 + c
          const j = y * width + x + c * height * width
          rgb[j] = alpha * (rgba[i] / 255.0) + (1 - alpha) * bgColor
        }
      }
    }
    return new ort.Tensor('float32', rgb, [1, 3, height, width])
  },

  toImageData(
    z: Float32Array,
    alpha3: Float32Array | null,
    width: number,
    height: number,
  ): ImageData {
    // CHW float -> HWC RGBA
    const rgba = new Uint8ClampedArray(height * width * 4)
    if (alpha3 !== null) {
      for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
          let alphaV = 0.0
          for (let c = 0; c < 3; ++c) {
            const i = (y * width + x) * 4 + c
            const j = y * width + x + c * height * width
            rgba[i] = z[j] * 255.0 + 0.49999
            alphaV += alpha3[j] * (1.0 / 3.0)
          }
          rgba[(y * width + x) * 4 + 3] = alphaV * 255.0 + 0.49999
        }
      }
    } else {
      rgba.fill(255)
      for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
          for (let c = 0; c < 3; ++c) {
            const i = (y * width + x) * 4 + c
            const j = y * width + x + c * height * width
            rgba[i] = z[j] * 255.0 + 0.49999
          }
        }
      }
    }
    return new ImageData(rgba, width, height)
  },

  cropTensor(bchw: ort.Tensor, x: number, y: number, width: number, height: number): ort.Tensor {
    const [B, C, H, W] = bchw.dims
    const src = bchw.data as Float32Array
    const ex = x + width
    const ey = y + height
    const roi = new Float32Array(B * C * height * width)
    let i = 0
    for (let b = 0; b < B; ++b) {
      const bi = b * C * H * W
      for (let c = 0; c < C; ++c) {
        const ci = bi + c * H * W
        for (let h = y; h < ey; ++h) {
          const hi = ci + h * W
          for (let w = x; w < ex; ++w) {
            roi[i++] = src[hi + w]
          }
        }
      }
    }
    return new ort.Tensor('float32', roi, [B, C, height, width])
  },

  checkSingleColor(x: ort.Tensor, alpha3: ort.Tensor | null): [number, number, number, number] | null {
    const [, , H, W] = x.dims
    const data = x.data as Float32Array
    const r = data[0]
    const g = data[1 * H * W]
    const b = data[2 * H * W]
    let a = 1.0
    const total = H * W
    for (let i = 0; i < total; ++i) {
      if (r !== data[i] || g !== data[i + total] || b !== data[i + 2 * total]) {
        return null
      }
    }
    if (alpha3 !== null) {
      const aData = alpha3.data as Float32Array
      a = aData[0]
      for (let i = 0; i < aData.length; ++i) {
        if (a !== aData[i]) return null
      }
    }
    return [r, g, b, a]
  },

  createSingleColorTensor(
    rgba: [number, number, number, number],
    size: number,
  ): [ort.Tensor, ort.Tensor] {
    const rgb = new Float32Array(size * size * 3)
    const alpha3 = new Float32Array(size * size * 3)
    alpha3.fill(rgba[3])
    for (let c = 0; c < 3; ++c) {
      const v = rgba[c]
      for (let i = 0; i < size * size; ++i) {
        rgb[c * size * size + i] = v
      }
    }
    return [
      new ort.Tensor('float32', rgb, [1, 3, size, size]),
      new ort.Tensor('float32', alpha3, [1, 3, size, size]),
    ]
  },

  async padding(
    x: ort.Tensor,
    left: number, right: number, top: number, bottom: number,
    mode: 'replication' | 'reflection',
  ): Promise<ort.Tensor> {
    const ses = await onnxSession.getSession(getHelperModelPath(`${mode}_pad`))
    if (!ses) throw new Error(`Failed to load ${mode}_pad model`)
    const feeds: Record<string, ort.Tensor> = {
      x,
      left: new ort.Tensor('int64', BigInt64Array.from([BigInt(left)]), []),
      right: new ort.Tensor('int64', BigInt64Array.from([BigInt(right)]), []),
      top: new ort.Tensor('int64', BigInt64Array.from([BigInt(top)]), []),
      bottom: new ort.Tensor('int64', BigInt64Array.from([BigInt(bottom)]), []),
    }
    const out = await ses.run(feeds)
    return out.y
  },

  async alphaBorderPadding(
    rgb: ort.Tensor,
    alpha: ort.Tensor,
    offset: number,
  ): Promise<ort.Tensor> {
    const ses = await onnxSession.getSession(getHelperModelPath('alpha_border_padding'))
    if (!ses) throw new Error('Failed to load alpha_border_padding model')
    const rgbSq = new ort.Tensor('float32', rgb.data as Float32Array, [rgb.dims[1], rgb.dims[2], rgb.dims[3]])
    const alphaSq = new ort.Tensor('float32', alpha.data as Float32Array, [alpha.dims[1], alpha.dims[2], alpha.dims[3]])
    const feeds: Record<string, ort.Tensor> = {
      rgb: rgbSq,
      alpha: alphaSq,
      offset: new ort.Tensor('int64', BigInt64Array.from([BigInt(offset)]), []),
    }
    const out = await ses.run(feeds)
    return new ort.Tensor('float32', out.y.data as Float32Array, [1, out.y.dims[0], out.y.dims[1], out.y.dims[2]])
  },
}
