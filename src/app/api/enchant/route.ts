/**
 * Server-side upscaling endpoint — the proven fallback path.
 * Spawns scripts/upscale.mjs (onnxruntime-node, same SwinUNet models + seam
 * blending as the browser engine) so users always get results even if the
 * browser AI engine stalls on their device.
 *
 * Free tool, single instance: one job at a time, extra requests get a clear
 * 503 instead of piling up RAM.
 */
import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

export const runtime = 'nodejs'
export const maxDuration = 800 // seconds

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024 // 25 MB
const KILL_AFTER_MS = 12 * 60 * 1000 // 12 min hard kill

let jobRunning = false

function runCli(inputPath: string, outPath: string, style: string, scale: number, denoise: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        'scripts/upscale.mjs',
        inputPath,
        '--scale', String(scale),
        '--denoise', String(denoise),
        '--style', style,
        '--out', outPath,
        '--quiet',
      ],
      { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stderr = ''
    const timer = setTimeout(() => {
      stderr += '\n[server] job exceeded time limit and was killed'
      child.kill('SIGKILL')
    }, KILL_AFTER_MS)
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0 && fs.existsSync(outPath)) resolve()
      else reject(new Error(`engine exited ${code}: ${stderr.slice(-400)}`))
    })
  })
}

export async function POST(req: NextRequest) {
  if (jobRunning) {
    return NextResponse.json(
      { error: 'Another image is being processed on the server right now — try again in a minute.' },
      { status: 503 },
    )
  }

  let dir: string | null = null
  jobRunning = true
  try {
    const form = await req.formData()
    const file = form.get('image')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No image received.' }, { status: 400 })
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'Image is too large for server processing (max 25 MB).' }, { status: 413 })
    }

    const style = ['art', 'art_scan', 'photo'].includes(String(form.get('style'))) ? String(form.get('style')) : 'art'
    const scaleRaw = Number(form.get('scale'))
    const scale = scaleRaw === 4 ? 4 : 2
    const denoiseRaw = Number(form.get('denoise'))
    const denoise = [-1, 0, 1, 2, 3].includes(denoiseRaw) ? denoiseRaw : -1

    dir = path.join(os.tmpdir(), `enchanter-${crypto.randomUUID()}`)
    await fs.promises.mkdir(dir, { recursive: true })
    const ext = (file.name.match(/\.(png|jpe?g|webp)$/i)?.[1] ?? 'png').toLowerCase()
    const inputPath = path.join(dir, `input.${ext}`)
    const outPath = path.join(dir, 'output.png')
    await fs.promises.writeFile(inputPath, Buffer.from(await file.arrayBuffer()))

    await runCli(inputPath, outPath, style, scale, denoise)

    const png = await fs.promises.readFile(outPath)
    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `attachment; filename="image_enchanter_${style}_${scale}x.png"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[api/enchant] failed:', msg)
    return NextResponse.json(
      { error: `Server processing failed: ${msg.slice(0, 300)}` },
      { status: 500 },
    )
  } finally {
    jobRunning = false
    if (dir) await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
