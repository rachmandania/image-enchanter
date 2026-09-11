'use client'

import { useCallback, useState, useRef } from 'react'

interface ImageUploaderProps {
  onImageUpload: (imageDataUrl: string) => void
}

export default function ImageUploader({ onImageUpload }: ImageUploaderProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file')
      return
    }

    setIsLoading(true)
    const reader = new FileReader()
    reader.onload = (e) => {
      const result = e.target?.result as string
      onImageUpload(result)
      setIsLoading(false)
    }
    reader.onerror = () => {
      setIsLoading(false)
      alert('Error reading file')
    }
    reader.readAsDataURL(file)
  }, [onImageUpload])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    
    const files = e.dataTransfer.files
    if (files.length > 0) {
      handleFile(files[0])
    }
  }, [handleFile])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      handleFile(files[0])
    }
  }, [handleFile])

  const handleClick = () => {
    fileInputRef.current?.click()
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        className={`
          relative border-2 border-dashed rounded-2xl p-12 md:p-16 text-center cursor-pointer
          transition-all duration-300 ease-in-out
          ${isDragging 
            ? 'border-primary-400 bg-primary-400/10 scale-[1.02]' 
            : 'border-dark-600 hover:border-primary-500 hover:bg-dark-800/50'
          }
          ${isLoading ? 'pointer-events-none opacity-50' : ''}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileInput}
          className="hidden"
        />
        
        <div className="flex flex-col items-center gap-6">
          {/* Upload Icon */}
          <div className={`
            w-20 h-20 rounded-full flex items-center justify-center
            ${isDragging ? 'bg-primary-500/20' : 'bg-dark-800'}
            transition-colors duration-300
          `}>
            {isLoading ? (
              <svg className="w-10 h-10 text-primary-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <svg className="w-10 h-10 text-dark-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            )}
          </div>

          {/* Text */}
          <div>
            <p className="text-xl font-semibold text-white mb-2">
              {isLoading ? 'Loading image...' : isDragging ? 'Drop your image here' : 'Drag & drop your image'}
            </p>
            <p className="text-dark-400">
              or <span className="text-primary-400 hover:text-primary-300">click to browse</span>
            </p>
          </div>

          {/* Supported formats */}
          <p className="text-sm text-dark-500">
            Supports JPG, PNG, WebP • Max 10MB
          </p>
        </div>
      </div>
    </div>
  )
}
