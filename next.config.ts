import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  // jsdom (tras de isomorphic-dompurify) citește fișiere interne cu fs la
  // runtime — bundlat de webpack, calea se rupe (ENOENT default-stylesheet.css).
  // Rămân externe și se încarcă din node_modules.
  serverExternalPackages: ["isomorphic-dompurify", "jsdom"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            // self, nu gol: dictarea vocală (microfon) și pozele la
            // raft/factură (cameră) sunt funcții de bază ale agentului.
            key: "Permissions-Policy",
            value:
              "camera=(self), microphone=(self), geolocation=(self), interest-cohort=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          {
            // CSP: doar propriul domeniu + hărțile OpenStreetMap. Orice
            // script/injecție din altă parte e refuzată de browser.
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
              "font-src 'self' data:",
              "connect-src 'self'",
              "media-src 'self' blob:",
              "worker-src 'self' blob:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "upgrade-insecure-requests",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default config;
