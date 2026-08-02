import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd()),
  devIndicators: false,
  // CloudBase's gateway intermittently truncates Next's gzip + chunked
  // responses. Let the platform transport complete static files instead.
  compress: false,
  // CloudBase can intermittently truncate responses from Next's runtime image
  // optimizer. The bundled illustrations are already compressed, so serving
  // them as static assets is both more predictable and avoids that proxy path.
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: "/illustrations/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
