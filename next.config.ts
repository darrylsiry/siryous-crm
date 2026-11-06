import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

/**
 * The page-wide Content-Security-Policy. Its job here is to stop text a model
 * was steered into writing (a brief, a draft, a coach reply) from sending CRM
 * data anywhere: nothing on a page may load or call anything but this site.
 * Next's own inline hydration scripts and inline styles need 'unsafe-inline';
 * the dev server also needs eval and its hot-reload socket.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    root: __dirname,
  },
  experimental: {
    // The CSV import page posts the whole file through a server action.
    serverActions: { bodySizeLimit: "10mb" },
  },
  // The app never uses next/image, so its optimizer endpoint (/_next/image)
  // is switched off rather than left reachable.
  images: { unoptimized: true },
  async headers() {
    return [
      {
        // Every page except the UX mockups, which send their own sandbox policy.
        source: "/((?!app-tests/mockups/).*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
