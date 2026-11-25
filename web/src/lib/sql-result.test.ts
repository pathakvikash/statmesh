import { describe, expect, it } from "vitest";
import { citedInRows, partialNotice, rowsLabel } from "./sql-result";

const c = (d: string) => ({ source_id: "mospi", dataset_id: d }) as never;
const cites = [c("plfs_annual"), c("cpi"), c("wpi")];

describe("citedInRows", () => {
  it("keeps only datasets in series_id cells", () => {
    const r = { columns: ["series_id", "value"], rows: [["mospi:plfs_annual:ur", 1]], citations: cites };
    expect(citedInRows(r).map((x) => x.dataset_id)).toEqual(["plfs_annual"]);
  });
  it("uses source_id + dataset_id columns", () => {
    const r = { columns: ["source_id", "dataset_id"], rows: [["mospi", "cpi"]], citations: cites };
    expect(citedInRows(r)).toHaveLength(1);
  });
  it("keeps all when nothing to narrow by", () => {
    expect(citedInRows({ columns: ["n"], rows: [[1]], citations: cites })).toHaveLength(3);
  });
});

describe("partialNotice", () => {
  const w = "Partial result, a row cap cut the data and results may be incomplete: mospi/cpi, mospi/wpi";
  it("hides it when no shown dataset is listed", () => expect(partialNotice(w, [cites[0]])).toBeNull());
  it("shows plain words plus only relevant datasets", () => {
    const n = partialNotice(w, [cites[1]])!;
    expect(n.datasets).toEqual(["mospi/cpi"]);
    expect(n.text).not.toMatch(/row cap/);
  });
  it("passes other warnings through", () => expect(partialNotice("No sources", [])?.text).toBe("No sources"));
});

describe("rowsLabel", () => {
  it("pluralises", () => {
    expect(rowsLabel(1)).toBe("1 row");
    expect(rowsLabel(1200)).toBe("1,200 rows");
  });
});
