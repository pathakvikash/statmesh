import next from "eslint-config-next/core-web-vitals";

const config = [...next, { ignores: [".next/**", "src/lib/api-types.ts"] }];
export default config;
