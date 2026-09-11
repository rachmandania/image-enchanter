# Image Enchanter

AI-powered image upscaling and denoising that runs entirely in your browser. Free, private, no API keys.

![Next.js](https://img.shields.io/badge/Next.js-14-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![License](https://img.shields.io/badge/license-MIT-green)

## What it does

- Upload an image (drag & drop or click)
- Pick a style (Artwork / Art Scan / Photo), denoise level (0–3), and scale (2x / 4x)
- AI enhances resolution and removes noise on-device
- Compare original vs enhanced at matched zoom, download the result as PNG

**Your images never leave your device.** There is no server-side processing, no upload, no tracking.

## Tech stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 14 (App Router, TypeScript) |
| AI runtime | onnxruntime-web (WASM SIMD, multithreaded) |
| Models | SwinUNet super-resolution ONNX models |
| Styling | Tailwind CSS |

## Getting started

```bash
bun install   # or npm install
bun run dev   # or npm run dev
```

Open http://localhost:3000.

## Notes

- The AI model (~19 MB) downloads once, then is cached by the browser — later runs start instantly.
- 4x uses a native 4x model. Large images take a few minutes on CPU; keep the tab open.
- Everything runs client-side: models stream from a public CDN, helper models ship in `/public`.

## Credits & licensing

The tiled inference and seam-blending engine in `src/lib/enchanter/` is derived from
[nunif](https://github.com/nagadomi/nunif) by nagadomi (MIT License). The pretrained ONNX
models are also released by the nunif project under MIT. We are grateful for that project —
attribution belongs here in the source, per the MIT license.

## License

MIT
