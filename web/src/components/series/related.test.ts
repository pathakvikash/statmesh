import { describe, expect, it } from "vitest";
import { exploreHeading, groupRelated } from "./related";
import type { RelatedHit } from "@/lib/client";

const h = (series_id: string, reason: string) => ({ series_id, reason }) as RelatedHit;

describe("explore next helpers", () => {
  it("groups by the other-source reason, keeping order", () => {
    const g = groupRelated([h("a", "Same dataset"), h("b", "Other source: World Bank"), h("c", "Also about Health · Other source: OECD"), h("d", "Also about X")]);
    expect(g.same.map((x) => x.series_id)).toEqual(["a", "d"]);
    expect(g.other.map((x) => x.series_id)).toEqual(["b", "c"]);
  });
  it("headline depends on the country", () => {
    expect(exploreHeading()).toBe("Explore next");
    expect(exploreHeading("China")).toBe("More about China");
  });
});
