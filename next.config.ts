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
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
    ];
  },
};

export default config;
