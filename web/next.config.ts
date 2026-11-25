import type { NextConfig } from "next";

const prod = process.env.NODE_ENV === "production";

// Report-only: never blocks. 'unsafe-inline' covers Next's inline bootstrap and the
// theme/assistant init script in app/layout.tsx; dev also needs 'unsafe-eval'.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${prod ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // on-device assistant: model weights from Hugging Face, WASM model libraries from GitHub raw
  "connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co https://raw.githubusercontent.com",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const security = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), microphone=(self)" },
  { key: "Content-Security-Policy-Report-Only", value: csp },
  ...(prod ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const config: NextConfig = {
  // self-host container (web/Dockerfile); Vercel ignores this
  output: "standalone",
  // spawns the local claude CLI; keep it out of the bundle
  serverExternalPackages: ["ai-sdk-provider-claude-code", "@anthropic-ai/claude-agent-sdk"],
  headers: async () => [
    { source: "/:path*", headers: security },
    // /a/<id> is the share-link permalink; its content is immutable per URL
    { source: "/a/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, immutable" }] },
  ],
};
export default config;
