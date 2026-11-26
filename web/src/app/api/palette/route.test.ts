import { describe, expect, it } from "vitest";
import { paletteHeaders } from "./headers";

describe("paletteHeaders", () => {
  it("sends a shared-cache header only when the web cache is on", () => {
    expect(paletteHeaders(true)["Cache-Control"]).toContain("s-maxage=300");
    expect(paletteHeaders(false)).toEqual({});
  });
});
