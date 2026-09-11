'use client'

import { useState } from 'react'
import ImageUploader from '@/components/ImageUploader'
import ImageProcessor from '@/components/ImageProcessor'

export default function Home() {
  const [originalImage, setOriginalImage] = useState<string | null>(null)
  const [processedImage, setProcessedImage] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [upscaleFactor, setUpscaleFactor] = useState<2 | 4>(2)

  const handleImageUpload = (imageDataUrl: string) => {
    setOriginalImage(imageDataUrl)
    setProcessedImage(null)
  }

  const handleReset = () => {
    setOriginalImage(null)
    setProcessedImage(null)
    setIsProcessing(false)
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-dark-950 via-dark-900 to-primary-950">
      {/* Header */}
      <header className="container mx-auto px-4 py-8">
        <div className="text-center">
          <h1 className="text-4xl md:text-6xl font-bold text-white mb-4">
            Image <span className="text-primary-400">Enchanter</span>
          </h1>
          <p className="text-lg md:text-xl text-dark-300 max-w-2xl mx-auto">
            Enhance your images with AI-powered upscaling. Free, fast, and runs entirely in your browser.
          </p>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-4 pb-16">
        {!originalImage ? (
          <ImageUploader onImageUpload={handleImageUpload} />
        ) : (
          <ImageProcessor
            originalImage={originalImage}
            processedImage={processedImage}
            isProcessing={isProcessing}
            upscaleFactor={upscaleFactor}
            onUpscaleFactorChange={setUpscaleFactor}
            onProcessingStart={() => setIsProcessing(true)}
            onProcessingComplete={setProcessedImage}
            onReset={handleReset}
          />
        )}
      </div>

      {/* Footer */}
      <footer className="container mx-auto px-4 py-8 text-center">
        <p className="text-dark-400 text-sm">
          100% Free • No API Keys Required • Runs in Your Browser
        </p>
      </footer>
    </main>
  )
}
