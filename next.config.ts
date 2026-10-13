import type { NextConfig } from "next";

// L'app è interamente dinamica (dati personali su database locale): niente Cache Components.
const nextConfig: NextConfig = {
  output: "standalone",
  // permette di avviare istanze separate (es. collaudo) senza conflitti sulla cartella di build
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  serverExternalPackages: ["exceljs"],
  outputFileTracingExcludes: { "*": ["tests/**"] },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
