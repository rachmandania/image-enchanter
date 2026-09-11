'use client'

import { useState } from 'react'
import ImageUploader from '@/components/ImageUploader'
import ImageProcessor from '@/components/ImageProcessor'

export default function Home() {
  const [originalImage, setOriginalImage] = useState<string | null>(null)

  return (
    <main className="min-h-screen">
      {/* Hero + Tool */}
      <section className="bg-gradient-to-br from-dark-950 via-dark-900 to-primary-950">
        <header className="container mx-auto px-4 pt-12 pb-8">
          <div className="text-center">
            <h1 className="text-4xl md:text-6xl font-bold text-white mb-4">
              Image <span className="text-primary-400">Enchanter</span>
            </h1>
            <p className="text-lg md:text-xl text-dark-300 max-w-2xl mx-auto text-balance">
              Enhance your images with AI-powered upscaling. Free, fast, and runs entirely in your browser.
            </p>
          </div>
        </header>

        <div className="container mx-auto px-4 pb-16">
          {originalImage ? (
            <ImageProcessor
              originalImage={originalImage}
              onReset={() => setOriginalImage(null)}
            />
          ) : (
            <ImageUploader onImageUpload={setOriginalImage} />
          )}
        </div>
      </section>

      {/* Features */}
      <section className="container mx-auto px-4 py-16">
        <h2 className="text-2xl md:text-3xl font-bold text-white text-center mb-10">
          Why Image Enchanter?
        </h2>
        <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {[
            {
              icon: '🔒',
              title: 'Private by design',
              desc: 'Your images never leave your device — everything runs locally in your browser.',
            },
            {
              icon: '💸',
              title: '100% free',
              desc: 'No accounts, no API keys, no usage limits. Open-source AI models do the work.',
            },
            {
              icon: '⚡',
              title: '2x & 4x upscale',
              desc: 'Choose your quality and scale. Watch progress in real time as AI enhances pixels.',
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

      {/* Footer */}
      <footer className="container mx-auto px-4 py-8 text-center border-t border-dark-800">
        <p className="text-dark-400 text-sm">
          100% Free • No API Keys Required • Runs in Your Browser
        </p>
      </footer>
    </main>
  )
}
