# Image Enchanter

AI-powered image upscaling that runs entirely in your browser. Free, private, no API keys.

![Next.js](https://img.shields.io/badge/Next.js-14-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![License](https://img.shields.io/badge/license-MIT-green)

## What it does

- Upload an image (drag & drop or click)
- Pick quality (Fast / Balanced / Best) and scale (2x / 4x)
- AI enhances resolution on-device via ESRGAN models (Upscaler.js + TensorFlow.js)
- Compare original vs enhanced with a draggable slider
- Download the result

**Your images never leave your device.** There is no server-side processing, no upload, no tracking.

## Tech stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 14 (App Router, TypeScript) |
| AI | Upscaler.js + TensorFlow.js (WebGL) |
| Models | ESRGAN (slim / medium / thick) |
| Styling | Tailwind CSS |

## Getting started

```bash
bun install   # or npm install
bun run dev   # or npm run dev
```

Open http://localhost:3000.

## Notes

- First run downloads the model (~1–5 MB) to your browser cache.
- 4x runs two sequential 2x passes internally.
- Very large inputs are capped to 1200px on the long edge before inference to avoid memory exhaustion.
- Quality: Fast = esrgan-slim, Balanced = esrgan-medium, Best = esrgan-thick.

## License

MIT
