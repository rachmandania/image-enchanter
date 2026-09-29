import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { BRAND } from '@/lib/brand'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: `${BRAND.name} - Merge scans & convert JPG/PNG/PDF`,
  description: `${BRAND.tagline}. Join images side by side or stacked, convert between JPG, PNG and PDF. Free, private, runs entirely in your browser.`,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  )
}
