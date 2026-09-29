/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static export: ScanClip is 100% client-side (no API routes, no server
  // features), so the production build emits a fully static site. This also
  // matches Freebuff hosting's static mode, which serves the exported output.
  output: 'export',
  // next/image needs an image optimization server, which a static export
  // doesn't have; the app uses plain <img> tags anyway, so keep it off.
  images: { unoptimized: true },
}

export default nextConfig
