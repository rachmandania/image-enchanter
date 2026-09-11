'use client'

import { useState } from 'react'

/**
 * Shows a movable crop window over an image at a given zoom level.
 * Both Original and Enhanced sides show the same picture region,
 * so the viewer can compare real detail at matched zoom.
 */
export default function PixelPeep({
  src,
  zoom,
  label,
}: {
  src: string
  zoom: number
  label: string
}) {
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 })

  return (
    <div>
      <div
        className="relative aspect-square rounded-xl overflow-hidden bg-dark-900 border border-dark-700 cursor-move"
        onMouseDown={(e) => {
          const startX = e.clientX
          const startY = e.clientY
          const startPos = { ...pos }
          const move = (ev: MouseEvent) => {
            setPos({
              x: Math.min(1, Math.max(0, startPos.x - (ev.clientX - startX) / (600 * zoom))),
              y: Math.min(1, Math.max(0, startPos.y - (ev.clientY - startY) / (600 * zoom))),
            })
          }
          const up = () => {
            window.removeEventListener('mousemove', move)
            window.removeEventListener('mouseup', up)
          }
          window.addEventListener('mousemove', move)
          window.addEventListener('mouseup', up)
        }}
        onTouchStart={(e) => {
          const t = e.touches[0]
          const startX = t.clientX
          const startY = t.clientY
          const startPos = { ...pos }
          const move = (ev: TouchEvent) => {
            const tt = ev.touches[0]
            if (!tt) return
            setPos({
              x: Math.min(1, Math.max(0, startPos.x - (tt.clientX - startX) / (600 * zoom))),
              y: Math.min(1, Math.max(0, startPos.y - (tt.clientY - startY) / (600 * zoom))),
            })
          }
          const end = () => {
            window.removeEventListener('touchmove', move)
            window.removeEventListener('touchend', end)
          }
          window.addEventListener('touchmove', move)
          window.addEventListener('touchend', end)
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={label}
          draggable={false}
          className="absolute max-w-none select-none"
          style={{
            width: `${zoom * 100}%`,
            left: `${(0.5 - pos.x) * zoom * 100}%`,
            top: `${(0.5 - pos.y) * zoom * 100}%`,
          }}
        />
        <span className="absolute top-2 left-2 text-xs bg-black/60 text-white px-2 py-1 rounded pointer-events-none">
          {label}
        </span>
      </div>
      <p className="text-center text-dark-500 text-xs mt-1">drag to move · {zoom}x zoom</p>
    </div>
  )
}
