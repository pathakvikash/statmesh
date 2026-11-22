import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  // spawns the local claude CLI; keep it out of the bundle
  serverExternalPackages: ["ai-sdk-provider-claude-code", "@anthropic-ai/claude-agent-sdk"],
  // /a/<id> is the share-link permalink; its content is immutable per URL
  headers: async () => [
    { source: "/a/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, immutable" }] },
  ],
};
export default config;
