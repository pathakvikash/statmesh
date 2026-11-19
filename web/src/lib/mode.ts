/** Runtime flags for the web server (read per request: pages that use them are force-dynamic). */
export const isHosted = () => process.env.STATMESH_MODE === "hosted";
export const siteUrl = () => (process.env.STATMESH_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
