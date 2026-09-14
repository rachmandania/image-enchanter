/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // onnxruntime-node + sharp ship native bindings — keep them out of the
  // webpack bundle so the API route loads them directly from node_modules.
  serverExternalPackages: ['onnxruntime-node', 'sharp'],
  // Cross-origin isolation unlocks multithreaded WASM for onnxruntime-web:
  // inference runs on multiple threads inside the proxy worker -> much faster tiles.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          // Firefox only supports `require-corp` (not `credentialless`). All our
          // cross-origin model fetches are CORS-enabled, so require-corp works
          // and gives real cross-origin isolation in both browsers.
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
    ]
  },
}

export default nextConfig
