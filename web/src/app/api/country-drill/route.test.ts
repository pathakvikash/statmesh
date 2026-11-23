import { describe, expect, it, vi } from "vitest";

const load = vi.fn();
vi.mock("@/lib/country-drill-data", () => ({ loadDrill: (...a: unknown[]) => load(...a) }));
import { GET } from "./route";

const req = () => new Request("http://x/api/country-drill?id=s:d:k&c=IND");

describe("country-drill route", () => {
  it("caches results with data only", async () => {
    load.mockResolvedValueOnce({ points: [{ t: "2020", v: 1 }] });
    expect((await GET(req())).headers.get("cache-control")).toContain("s-maxage=300");
    load.mockResolvedValueOnce({ points: [] });
    expect((await GET(req())).headers.get("cache-control")).toBeNull();
  });
  it("502 body is generic and uncached", async () => {
    load.mockRejectedValueOnce(new Error("fetch http://127.0.0.1:8000/query failed"));
    const r = await GET(req());
    expect(r.status).toBe(502);
    expect(JSON.stringify(await r.json())).not.toMatch(/127|http/);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
});
