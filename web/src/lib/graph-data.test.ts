import { describe, expect, it } from "vitest";
import { validateGraph } from "./graph-data";

const payload = {
  nodes: [{ id: "indicator:a:b:c", kind: "indicator", label: "C" }],
  edges: [{ from: "source:a", to: "indicator:a:b:c", kind: "published_by", reason: "Same dataset" }],
};

describe("validateGraph", () => {
  it("drops edges whose endpoint is outside the payload by default", () => {
    expect(validateGraph(payload).edges).toHaveLength(0);
  });
  it("keeps expansion edges that point at the already-shown node", () => {
    expect(validateGraph(payload, ["source:a"]).edges).toHaveLength(1);
  });
});
