/** Runtime flags for the web server (read per request: pages that use them are force-dynamic). */
// A Vercel deployment is public, so it is hosted unless STATMESH_MODE says otherwise.
export const isHosted = () => (process.env.STATMESH_MODE || (process.env.VERCEL ? "hosted" : "")) === "hosted";
export const siteUrl = () => (process.env.STATMESH_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
