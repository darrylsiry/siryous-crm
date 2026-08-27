import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    root: __dirname,
  },
  experimental: {
    // The CSV import page posts the whole file through a server action.
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
