import type { NextConfig } from "next";

// Domini da cui sono ammesse le Server Actions oltre a quello dell'app: in GitHub Codespaces il
// proxy delle porte inoltra un host diverso da quello che il browser vede nella barra degli indirizzi.
// Valutato durante la build, che in Codespaces avviene dentro il codespace stesso.
const codespacesDomain = process.env.CODESPACES === "true" ? process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN : undefined;
const allowedOrigins = [
  ...(codespacesDomain ? [`*.${codespacesDomain}`] : []),
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
