/**
 * Cumulative Tile Seam/Border Blending.
 * Ported from nagadomi/nunif unlimited_waifu2x (seam_blending.js), MIT License.
 * Original: nunif/utils/seam_blending.py
 *
 * Overlapping tiles are weighted-blended into one output buffer so there are
 * no visible seams between tiles (this is what makes waifu2x output clean).
 */
import * as ort from 'onnxruntime-web'
import { getHelperModelPath } from './config'
import { onnxSession } from './session'

const BLEND_SIZE = 16

export interface RenderingParams {
  h_blocks: number
  w_blocks: number
  input_tile_step: number
  output_tile_step: number
  y_buffer_h: number
  y_buffer_w: number
  pad: [number, number, number, number]
}

export class SeamBlending {
  private x_size: [number, number, number, number]
  private scale: number
  private offset: number
  private tile_size: number
  private blend_size: number

  pixels!: ort.Tensor
  weights!: ort.Tensor
  output!: ort.Tensor
  blend_filter!: ort.Tensor
  param!: RenderingParams

  constructor(
    x_size: [number, number, number, number],
    scale: number,
    offset: number,
    tile_size: number,
    blend_size = BLEND_SIZE,
  ) {
    this.x_size = x_size
    this.scale = scale
    this.offset = offset
    this.tile_size = tile_size
    this.blend_size = blend_size
  }

  async build(): Promise<void> {
    this.param = SeamBlending.calcParameters(
      this.x_size, this.scale, this.offset, this.tile_size, this.blend_size,
    )
    const { y_buffer_h, y_buffer_w } = this.param
    this.pixels = new ort.Tensor(
      'float32',
      new Float32Array(y_buffer_h * y_buffer_w * 3),
      [3, y_buffer_h, y_buffer_w],
    )
    this.weights = new ort.Tensor(
      'float32',
      new Float32Array(y_buffer_h * y_buffer_w * 3),
      [3, y_buffer_h, y_buffer_w],
    )
    this.blend_filter = await this.createSeamBlendingFilter()
    this.output = new ort.Tensor(
      'float32',
      new Float32Array(this.blend_filter.data.length),
      this.blend_filter.dims,
    )
  }

  getRenderingConfig(): RenderingParams {
    return this.param
  }

  /** Blend a newly-inferred tile into the output buffer. Returns the updated buffer view. */
  update(x: ort.Tensor, tileI: number, tileJ: number): ort.Tensor {
    const stepSize = this.param.output_tile_step
    const [, H, W] = this.blend_filter.dims
    const HW = H * W
    const bufferH = this.pixels.dims[1]
    const bufferW = this.pixels.dims[2]
    const bufferHW = bufferH * bufferW
    const hI = stepSize * tileI
    const wJ = stepSize * tileJ

    const pixelsData = this.pixels.data as Float32Array
    const weightsData = this.weights.data as Float32Array
    const filterData = this.blend_filter.data as Float32Array
    const xData = x.data as Float32Array
    const outData = this.output.data as Float32Array

    let oldWeight: number, nextWeight: number, newWeight: number
    for (let c = 0; c < 3; ++c) {
      for (let i = 0; i < H; ++i) {
        for (let j = 0; j < W; ++j) {
          const tileIndex = c * HW + i * W + j
          const bufferIndex = c * bufferHW + (hI + i) * bufferW + (wJ + j)
          oldWeight = weightsData[bufferIndex]
          nextWeight = oldWeight + filterData[tileIndex]
          oldWeight = oldWeight / nextWeight
          newWeight = 1.0 - oldWeight
          pixelsData[bufferIndex] =
            pixelsData[bufferIndex] * oldWeight + xData[tileIndex] * newWeight
          weightsData[bufferIndex] += filterData[tileIndex]
          outData[tileIndex] = pixelsData[bufferIndex]
        }
      }
    }
    return this.output
  }

  private async createSeamBlendingFilter(): Promise<ort.Tensor> {
    const ses = await onnxSession.getSession(getHelperModelPath('create_seam_blending_filter'))
    if (!ses) throw new Error('Failed to load create_seam_blending_filter model')
    const scale = new ort.Tensor('int64', BigInt64Array.from([BigInt(this.scale)]), [])
    const offset = new ort.Tensor('int64', BigInt64Array.from([BigInt(this.offset)]), [])
    const tileSize = new ort.Tensor('int64', BigInt64Array.from([BigInt(this.tile_size)]), [])
    const feeds: Record<string, ort.Tensor> = {
      scale, offset, tile_size: tileSize,
    }
    const out = await ses.run(feeds)
    return out.y
  }

  private static calcParameters(
    x_size: [number, number, number, number],
    scale: number,
    offset: number,
    tile_size: number,
    blend_size: number,
  ): RenderingParams {
    const xH = x_size[2]
    const xW = x_size[3]

    const yH = xH * scale
    const yW = xW * scale

    const inputOffset = Math.ceil(offset / scale)
    const inputBlendSize = Math.ceil(blend_size / scale)
    const inputTileStep = tile_size - (inputOffset * 2 + inputBlendSize)
    const outputTileStep = inputTileStep * scale

    let [hBlocks, wBlocks, inputH, inputW] = [0, 0, 0, 0]
    while (inputH < xH + inputOffset * 2) {
      inputH = hBlocks * inputTileStep + tile_size
      ++hBlocks
    }
    while (inputW < xW + inputOffset * 2) {
      inputW = wBlocks * inputTileStep + tile_size
      ++wBlocks
    }

    return {
      h_blocks: hBlocks,
      w_blocks: wBlocks,
      input_tile_step: inputTileStep,
      output_tile_step: outputTileStep,
      y_buffer_h: inputH * scale,
      y_buffer_w: inputW * scale,
      pad: [
        inputOffset,
        inputW - (xW + inputOffset),
        inputOffset,
        inputH - (xH + inputOffset),
      ],
    }
  }
}
