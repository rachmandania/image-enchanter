/**
 * Copies the Next.js static export (out/) to dist/ after `next build`.
 * Freebuff hosting's static mode serves dist/, Next.js exports to out/ —
 * this bridges the two without changing the app.
 */
import { cpSync, existsSync, rmSync } from 'node:fs'

if (existsSync('dist')) rmSync('dist', { recursive: true, force: true })
cpSync('out', 'dist', { recursive: true })
console.log('Copied out/ → dist/ for static hosting.')
