import { afterEach, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllGlobals());
const call = (id: string) => GET(new Request(`http://x/api/series-csv?id=${encodeURIComponent(id)}`));

it("streams the API body through with a sanitised filename and attribution", async () => {
  const fetchMock = vi.fn(async (_u: unknown) => new Response("a,b\r\n1,2\r\n", { headers: { "x-statmesh-attribution": "Open Org" } }));
  vi.stubGlobal("fetch", fetchMock);
  const r = await call("open:D:UNEMP/x y");
  expect(String(fetchMock.mock.calls[0][0])).toContain("/series/open%3AD%3AUNEMP/x%20y/observations.csv");
  expect(r.headers.get("content-disposition")).toBe('attachment; filename="open_D_UNEMP_x_y.csv"');
  expect(r.headers.get("x-statmesh-attribution")).toBe("Open Org");
  expect(await r.text()).toBe("a,b\r\n1,2\r\n");
});

it("maps API errors", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "forbidden" }), { status: 403 })));
  expect((await call("closed:D:X")).status).toBe(403);
  expect((await call("")).status).toBe(400);
});
