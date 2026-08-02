import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd()),
  devIndicators: false,
  // CloudBase can intermittently truncate responses from Next's runtime image
  // optimizer. The bundled illustrations are already compressed, so serving
  // them as static assets is both more predictable and avoids that proxy path.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
