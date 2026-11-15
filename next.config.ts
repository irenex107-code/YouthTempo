import type { NextConfig } from "next";
import path from "node:path";
import { isReportsLocalIntegrationEnabled } from "./lib/reports/availability";

const isDevelopment = process.env.NODE_ENV === "development";
// Only the explicitly enabled local report integration needs browser Auth
// traffic to its disposable database. Production keeps its existing CSP.
const localReportOrigin = isDevelopment && isReportsLocalIntegrationEnabled()
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin : "";

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "frame-src 'none'",
      "form-action 'self'",
      `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src 'self' https://*.supabase.co wss://*.supabase.co${localReportOrigin ? ` ${localReportOrigin}` : ""}`,
      "worker-src 'self' blob:",
      "manifest-src 'self'",
    ].join("; "),
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  distDir: localReportOrigin ? ".next-reports-integration" : ".next",
  outputFileTracingRoot: path.resolve(process.cwd()),
  devIndicators: false,
  i18n: {
    locales: ["zh-CN", "en"],
    defaultLocale: "zh-CN",
    localeDetection: false,
  },
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
        source: "/:path*",
        headers: securityHeaders,
      },
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
