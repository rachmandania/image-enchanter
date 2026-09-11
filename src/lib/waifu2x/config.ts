/**
 * waifu2x ONNX model configuration.
 * Ported from nagadomi/nunif unlimited_waifu2x (models.js), MIT License.
 *
 * Models are served from Hugging Face (deepghs/waifu2x_onnx) with CORS enabled,
 * so no API keys or server-side processing are needed.
 */

export const MODEL_CDN = 'https://huggingface.co/deepghs/waifu2x_onnx/resolve/main/20230504/onnx_models'

export type Style = 'art' | 'art_scan' | 'photo'
export type MethodName =
  | 'scale1x' | 'scale2x' | 'scale4x'
  | 'noise0' | 'noise1' | 'noise2' | 'noise3'
  | 'noise0_scale2x' | 'noise1_scale2x' | 'noise2_scale2x' | 'noise3_scale2x'
  | 'noise0_scale4x' | 'noise1_scale4x' | 'noise2_scale4x' | 'noise3_scale4x'

interface MethodDef {
  name: MethodName
  scale: 1 | 2 | 4
  offset: number
  has_noise: boolean
}

interface StyleDef {
  color_stability: boolean
  padding: 'replication' | 'reflection'
}

interface ArchDef {
  arch: string
  calc_tile_size: (tile: number, scale: number) => number
  styles: Record<string, StyleDef>
  methods: MethodDef[]
}

export interface ModelConfig {
  arch: string
  domain: Style
  calc_tile_size: (tile: number, scale: number) => number
  scale: 1 | 2 | 4
  offset: number
  color_stability: boolean
  padding: 'replication' | 'reflection'
  path: string
}

export const STYLES: { value: Style; label: string; desc: string }[] = [
  { value: 'art', label: 'Artwork', desc: 'Anime / illustrations / game art' },
  { value: 'art_scan', label: 'Art Scan', desc: 'Scanned or screenshotted artwork with compression noise' },
  { value: 'photo', label: 'Photo', desc: 'Photographs and realistic images' },
]

export const NOISE_LEVELS: { value: number; label: string }[] = [
  { value: -1, label: 'None' },
  { value: 0, label: 'None (0)' },
  { value: 1, label: 'Low (1)' },
  { value: 2, label: 'Medium (2)' },
  { value: 3, label: 'High (3)' },
]

const SWIN_UNET: ArchDef = {
  arch: 'swin_unet',
  calc_tile_size: (tile) => {
    while ((tile - 16) % 12 !== 0 || (tile - 16) % 16 !== 0) tile += 1
    return tile
  },
  styles: {
    art: { color_stability: true, padding: 'replication' },
    art_scan: { color_stability: false, padding: 'replication' },
    photo: { color_stability: false, padding: 'reflection' },
  },
  methods: [
    { name: 'scale1x', scale: 1, offset: 8, has_noise: true },
    { name: 'scale2x', scale: 2, offset: 16, has_noise: true },
    { name: 'scale4x', scale: 4, offset: 32, has_noise: true },
  ],
}

function genArchConfig(): Record<string, Record<string, Record<string, ModelConfig>>> {
  const config: Record<string, Record<string, Record<string, ModelConfig>>> = {}
  for (const model of [SWIN_UNET]) {
    config[model.arch] = {}
    for (const [style, styleConfig] of Object.entries(model.styles)) {
      config[model.arch][style] = {}
      for (const m of model.methods) {
        const base: ModelConfig = {
          arch: model.arch,
          domain: style as Style,
          calc_tile_size: model.calc_tile_size,
          ...styleConfig,
          scale: m.scale,
          offset: m.offset,
          path: '',
        }
        config[model.arch][style][m.name] = base
        if (m.has_noise) {
          for (let i = 0; i < 4; i++) {
            const noiseMethod = m.name === 'scale1x' ? `noise${i}` : `noise${i}_${m.name}`
            config[model.arch][style][noiseMethod] = base
          }
        }
      }
    }
  }
  return config
}

const ARCH = genArchConfig()

export function getConfig(arch: string, style: Style, method: string): ModelConfig | null {
  const entry = ARCH[arch]?.[style]?.[method]
  if (entry) {
    return { ...entry, path: `${MODEL_CDN}/${arch}/${style}/${method}.onnx` }
  }
  return null
}

export function getHelperModelPath(name: string): string {
  // pad models are not on the HF mirror — served locally from /public
  if (name === 'replication_pad' || name === 'reflection_pad') {
    return `/models/utils/${name}.onnx`
  }
  return `${MODEL_CDN}/utils/${name}.onnx`
}
