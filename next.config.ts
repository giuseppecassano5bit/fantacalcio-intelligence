import type { NextConfig } from "next";

// Origini da cui sono ammesse le Server Actions oltre a quella dell'app. In GitHub Codespaces il proxy
// delle porte riscrive l'intestazione Origin in "localhost:3000" mentre x-forwarded-host resta il dominio
// pubblico: senza questa voce Next.js rifiuta login e registrazione. Valutato durante la build, che in
// Codespaces avviene dentro il codespace stesso (scripts/avvia.mjs).
const codespacesDomain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
const allowedOrigins = [
  ...(process.env.CODESPACES === "true" ? ["localhost:3000", ...(codespacesDomain ? [`*.${codespacesDomain}`] : [])] : []),
  ...(process.env.SERVER_ACTIONS_ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean),
];

// L'app è interamente dinamica (dati personali su database locale): niente Cache Components.
const nextConfig: NextConfig = {
  output: "standalone",
  // permette di avviare istanze separate (es. collaudo) senza conflitti sulla cartella di build
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  serverExternalPackages: ["exceljs"],
  outputFileTracingExcludes: { "*": ["tests/**"] },
  experimental: allowedOrigins.length ? { serverActions: { allowedOrigins } } : {},
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
