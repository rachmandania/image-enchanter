'use client'

import DocClipper from '@/components/DocClipper'
import { BRAND } from '@/lib/brand'

export default function Home() {
  return (
    <main className="min-h-screen">
      {/* Hero + tool */}
      <section className="bg-gradient-to-br from-dark-950 via-dark-900 to-primary-950">
        <header className="container mx-auto px-4 pt-14 pb-10 text-center">
          <h1 className="text-4xl md:text-6xl font-bold text-white mb-4">
            {BRAND.name.split('Clip')[0]}
            <span className="text-primary-400">Clip</span>
          </h1>
          <p className="text-lg md:text-xl text-dark-300 max-w-2xl mx-auto text-balance">
            {BRAND.tagline} — merge scans side by side or stacked, convert
            between JPG, PNG and PDF. Free, instant, and nothing leaves your
            device.
          </p>
        </header>

        <div className="container mx-auto px-4 pb-16">
          <DocClipper />
        </div>
      </section>

      {/* Why */}
      <section className="container mx-auto px-4 py-16">
        <h2 className="text-2xl md:text-3xl font-bold text-white text-center mb-10">
          Built for real upload forms
        </h2>
        <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {[
            {
              icon: '📄',
              title: 'Two-sided scans, one file',
              desc: 'Front and back of an ID, transcript page 1 and 2 — joined side by side so the portal accepts it as one file.',
            },
            {
              icon: '🗂️',
              title: 'Real PDFs, your choice',
              desc: 'One joined page or one page per image — sized exactly to your scans, no white borders, no quality loss.',
            },
            {
              icon: '🔒',
              title: 'Private by design',
              desc: 'Everything runs in your browser with canvas and jsPDF. No uploads, no accounts, no watermarks — works offline.',
            },
          ].map((f) => (
            <div
              key={f.title}
              className="bg-dark-800/50 border border-dark-700/50 rounded-2xl p-6 hover:border-primary-500/40 transition-colors"
            >
              <div className="text-3xl mb-3">{f.icon}</div>
              <h3 className="text-white font-semibold mb-2">{f.title}</h3>
              <p className="text-dark-400 text-sm">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="container mx-auto px-4 py-8 text-center border-t border-dark-800">
        <p className="text-dark-400 text-sm">
          100% Free · No Uploads · No Sign-up · Runs Entirely in Your Browser
        </p>
      </footer>
    </main>
  )
}
