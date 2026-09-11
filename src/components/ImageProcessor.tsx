'use client'

import { useState, useEffect, useCallback } from 'react'
import Upscaler from 'upscaler'
import x2 from '@upscalerjs/esrgan-thick/2x'
import x4 from '@upscalerjs/esrgan-thick/4x'

interface ImageProcessorProps {
  originalImage: string
  processedImage: string | null
  isProcessing: boolean
  upscaleFactor: 2 | 4
  onUpscaleFactorChange: (factor: 2 | 4) => void
  onProcessingStart: () => void
  onProcessingComplete: (image: string) => void
  onReset: () => void
}

export default function ImageProcessor({
  originalImage,
  processedImage,
  isProcessing,
  upscaleFactor,
  onUpscaleFactorChange,
  onProcessingStart,
  onProcessingComplete,
  onReset,
}: ImageProcessorProps) {
  const [progress, setProgress] = useState(0)
  const [showComparison, setShowComparison] = useState(false)

  const handleUpscale = useCallback(async () => {
    if (isProcessing) return

    onProcessingStart()
    setProgress(0)

    try {
      const model = upscaleFactor === 2 ? x2 : x4
      const upscaler = new Upscaler({ model })

      // Simulate progress (actual progress isn't available in Upscaler.js)
      const progressInterval = setInterval(() => {
        setProgress((prev) => Math.min(prev + 5, 90))
      }, 500)

      const upscaledImage = await upscaler.upscale(originalImage, {
        patchSize: 64,
        padding: 5,
      })

      clearInterval(progressInterval)
      setProgress(100)
      
      onProcessingComplete(upscaledImage)
      setShowComparison(true)
    } catch (error) {
      console.error('Upscaling failed:', error)
      alert('Failed to upscale image. Please try a smaller image.')
      onReset()
    }
  }, [originalImage, upscaleFactor, isProcessing, onProcessingStart, onProcessingComplete, onReset])

  const handleDownload = () => {
    if (!processedImage) return

    const link = document.createElement('a')
    link.href = processedImage
    link.download = `enchanter-${upscaleFactor}x-${Date.now()}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Controls */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
        {/* Upscale Factor */}
        <div className="flex items-center gap-2 bg-dark-800/50 rounded-lg p-1">
          <button
            onClick={() => onUpscaleFactorChange(2)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              upscaleFactor === 2
                ? 'bg-primary-500 text-white'
                : 'text-dark-300 hover:text-white'
            }`}
          >
            2x Upscale
          </button>
          <button
            onClick={() => onUpscaleFactorChange(4)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              upscaleFactor === 4
                ? 'bg-primary-500 text-white'
                : 'text-dark-300 hover:text-white'
            }`}
          >
            4x Upscale
          </button>
        </div>

        {/* Actions */}
        {!isProcessing && !processedImage && (
          <button
            onClick={handleUpscale}
            className="px-6 py-3 bg-primary-500 hover:bg-primary-600 text-white font-semibold rounded-lg transition-colors"
          >
            Enchance Image
          </button>
        )}

        {processedImage && (
          <>
            <button
              onClick={handleDownload}
              className="px-6 py-3 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-lg transition-colors"
            >
              Download Result
            </button>
            <button
              onClick={onReset}
              className="px-6 py-3 bg-dark-700 hover:bg-dark-600 text-white font-semibold rounded-lg transition-colors"
            >
              Start Over
            </button>
          </>
        )}
      </div>

      {/* Processing Progress */}
      {isProcessing && (
        <div className="mb-8">
          <div className="bg-dark-800/50 rounded-lg p-6 max-w-md mx-auto">
            <div className="flex items-center gap-3 mb-4">
              <svg className="w-6 h-6 text-primary-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="text-white font-medium">Enhancing your image...</span>
            </div>
            <div className="w-full bg-dark-700 rounded-full h-2">
              <div 
                className="bg-primary-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-dark-400 text-sm mt-2 text-center">
              {upscaleFactor === 2 ? '2x' : '4x'} upscale in progress
            </p>
          </div>
        </div>
      )}

      {/* Image Comparison */}
      {showComparison && processedImage ? (
        <div className="grid md:grid-cols-2 gap-6">
          {/* Original */}
          <div className="bg-dark-800/50 rounded-2xl p-4">
            <h3 className="text-white font-medium mb-3 text-center">Original</h3>
            <div className="relative aspect-square overflow-hidden rounded-xl bg-dark-900">
              <img 
                src={originalImage} 
                alt="Original" 
                className="w-full h-full object-contain"
              />
            </div>
          </div>

          {/* Processed */}
          <div className="bg-dark-800/50 rounded-2xl p-4">
            <h3 className="text-white font-medium mb-3 text-center">
              Enhanced ({upscaleFactor}x)
            </h3>
            <div className="relative aspect-square overflow-hidden rounded-xl bg-dark-900">
              <img 
                src={processedImage} 
                alt="Enhanced" 
                className="w-full h-full object-contain"
              />
            </div>
          </div>
        </div>
      ) : (
        /* Single Image Preview (before processing) */
        <div className="bg-dark-800/50 rounded-2xl p-4 max-w-2xl mx-auto">
          <h3 className="text-white font-medium mb-3 text-center">Original Image</h3>
          <div className="relative aspect-square overflow-hidden rounded-xl bg-dark-900">
            <img 
              src={originalImage} 
              alt="Original" 
              className="w-full h-full object-contain"
            />
          </div>
        </div>
      )}
    </div>
  )
}
