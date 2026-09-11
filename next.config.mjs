/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Cross-origin isolation unlocks multithreaded WASM for onnxruntime-web:
  // inference runs on multiple threads inside the proxy worker -> much faster tiles.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
    ]
  },
}

export default nextConfig
