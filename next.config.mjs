/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // The database layer uses node:sqlite (built into Node 22.5+), so there is no
  // native module to keep out of the bundle. It still must not be traced into
  // client chunks — every import of it sits behind 'server-only'.
  serverExternalPackages: [],
}

export default nextConfig
