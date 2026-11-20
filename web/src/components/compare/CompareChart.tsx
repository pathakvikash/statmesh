"use client";
import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { GeoPicker } from "@/components/GeoExplorer";
import { RangeControl } from "@/components/SeriesChart";
import { MAX_GEOS, buildCompare, compareCsv, type Built, type Line as CLine } from "@/lib/compare";
import { formatCompact, periodLabel } from "@/lib/format";
import { inWindow, rangeState, type PresetId } from "@/lib/range";
import { btn } from "@/lib/ui";

/** One series on the page: `points` hold every (country, period) value the server loaded for the selected countries. */
export type CompareSeries = { id: string; title: string; unit: string; freq: string | null; points: { geo: string; t: string; v: number }[] };

const COLORS = Array.from({ length: 10 }, (_, i) => `var(--color-chart-${i + 1})`);
// Series 1 to 4: solid, dashed, dotted, dash-dot. Colour is per country, so the two encodings never clash.
const DASH = ["", "6 4", "2 3", "8 3 2 3"];
const chipCls = "inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-0.5 text-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60";

type Meta = { key: string; si: number; gi: number; label: string; unit: string; freq: string | null; points: { t: string; v: number }[] };

/** Several series by country on one chart: one line per (series, country), with the shared country and range controls. */
export function CompareChart({ series, geos, geoOptions, notes, slug }: {
  series: CompareSeries[]; geos: string[]; geoOptions: { geo: string; name: string; missing: string[] }[]; notes: string[]; slug: string;
}) {
  const router = useRouter(), path = usePathname(), params = useSearchParams();
  const [asIndex, setAsIndex] = useState(false);
  const [preset, setPreset] = useState<PresetId>("Max");
  const names = useMemo(() => new Map(geoOptions.map((g) => [g.geo, g.name])), [geoOptions]);
  // Countries with data for every drawn series first (stable, so the order inside each group is kept). A country missing
  // a series says so in a muted hint (search matches the name only).
  const candidates = useMemo(() => [...geoOptions].sort((a, b) => a.missing.length - b.missing.length).map((g) => ({
    geo: g.geo, name: g.name, hint: g.missing.length ? `(no data for ${g.missing.join("; ")})` : undefined,
  })), [geoOptions]);

  const meta = useMemo<Meta[]>(() => series.flatMap((s, si) => geos.map((g, gi) => ({
    key: `s${si}|${g}`, si, gi, label: `${s.title}, ${names.get(g) ?? g}`, unit: s.unit, freq: s.freq,
    points: s.points.filter((p) => p.geo === g).map((p) => ({ t: p.t, v: p.v })),
  }))), [series, geos, names]);
  const drawable = useMemo(() => meta.filter((m) => m.points.length), [meta]);
  const empty = meta.filter((m) => !m.points.length).map((m) => m.label);
  const built: Built = useMemo(() => buildCompare(drawable.map(({ key, label, unit, freq, points }): CLine => ({ key, label, unit, freq, points })), asIndex), [drawable, asIndex]);

  const byKey = useMemo(() => new Map(meta.map((m) => [m.key, m])), [meta]);
  const ok = built.status === "ok" ? built : undefined;
  const rows = useMemo(() => ok?.rows ?? [], [ok]);
  const periods = useMemo(() => rows.map((r) => String(r.t)), [rows]);
  const range = useMemo(() => rangeState(periods, preset), [periods, preset]);
  const data = useMemo(() => (range.from === null ? rows : rows.filter((r) => inWindow(String(r.t), range.from))), [rows, range.from]);

  const indexed = !!ok?.indexed;
  const dual = ok?.mode === "dual" && !indexed;
  const leftUnit = indexed ? "Index" : (ok?.units[0] ?? "");
  const rightUnit = dual ? (ok?.units[1] ?? "") : "";
  const lineUnit = (k: string) => (indexed ? "index" : byKey.get(k)?.unit ?? "");
  const dots = data.length <= 40;
  const forcedIndex = ok?.mode === "index";

  const info: string[] = [];
  if (ok) {
    if (ok.aligned) info.push("Aligned to annual averages: the series have different frequencies.");
    if (forcedIndex) info.push("More than two units, so the chart shows an index.");
    if (indexed && ok.base) info.push(`Index: ${periodLabel(ok.base, ok.freq)} = 100.`);
    if (ok.dropped.length) info.push(`Not indexed (base value is zero): ${ok.dropped.map((k) => byKey.get(k)?.label ?? k).join("; ")}.`);
  }
  const allNotes = [...info, ...notes];

  const setGeos = (next: string[]) => {
    const p = new URLSearchParams(params.toString());
    p.set("geo", next.join(","));
    router.replace(`${path}?${p}`, { scroll: false });
  };
  const toggleGeo = (g: string) => {
    if (geos.includes(g)) { if (geos.length > 1) setGeos(geos.filter((x) => x !== g)); return; }
    if (geos.length < MAX_GEOS) setGeos([...geos, g]);
  };

  const download = () => {
    if (!ok) return;
    const labels = ok.keys.map((k) => byKey.get(k)?.label ?? k);
    const url = URL.createObjectURL(new Blob([compareCsv(ok.rows, ok.keys, labels)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug.replace(/[^\w.-]+/g, "_")}-compare.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 4 });
  const latest = (k: string) => {
    for (let i = rows.length - 1; i >= 0; i--) if (typeof rows[i][k] === "number") return { t: String(rows[i].t), v: rows[i][k] as number };
    return undefined;
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <GeoPicker noun="countries" candidates={candidates} selected={geos} cap={MAX_GEOS} onToggle={toggleGeo} />
        {geos.map((g) => (
          <button key={g} type="button" disabled={geos.length === 1} onClick={() => toggleGeo(g)} aria-label={`Remove ${names.get(g) ?? g}`} className={chipCls}>
            {names.get(g) ?? g} <span aria-hidden className="text-muted-foreground">×</span>
          </button>
        ))}
        <button type="button" aria-pressed={indexed} disabled={forcedIndex} onClick={() => setAsIndex((v) => !v)}
          className={`inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${indexed ? "bg-accent text-accent-foreground" : "bg-card hover:bg-muted"}`}>
          {forcedIndex ? "Index (more than two units)" : "Show as index"}
        </button>
        <button type="button" onClick={download} disabled={!ok} className={`${btn} disabled:cursor-not-allowed disabled:opacity-60`}>Download CSV</button>
      </div>

      {allNotes.map((n) => <p key={n} className="text-xs text-muted-foreground">{n}</p>)}
      {empty.length > 0 && <p role="status" className="text-xs text-muted-foreground">No values for {empty.join("; ")}.</p>}

      {built.status === "empty" && <p className="py-10 text-center text-sm text-muted-foreground">No values for the selected series and countries.</p>}
      {(built.status === "no-overlap" || built.status === "no-index") && (
        <p role="alert" className="rounded-xl border border-border p-4 text-sm">{built.message}</p>
      )}

      {ok && (
        <>
          <RangeControl periods={periods} state={range} onSelect={setPreset} freq={ok.freq} className="mb-3" />
          <div style={{ height: 360 }} className="w-full" role="img"
            aria-label={`Line chart of ${ok.keys.map((k) => byKey.get(k)?.label ?? k).join(", ")}${leftUnit ? ` in ${leftUnit}` : ""}`}>
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 360 }}>
              <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="t" tickFormatter={(t: string) => periodLabel(t, ok.freq)} minTickGap={48} tickLine={false} axisLine={{ stroke: "var(--color-border)" }} />
                <YAxis yAxisId="left" tickFormatter={(v: number) => formatCompact(v)} width={56} tickLine={false} axisLine={false} domain={["auto", "auto"]}
                  label={leftUnit ? { value: leftUnit, angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "var(--color-muted-foreground)" } } : undefined} />
                {dual && (
                  <YAxis yAxisId="right" orientation="right" tickFormatter={(v: number) => formatCompact(v)} width={56} tickLine={false} axisLine={false} domain={["auto", "auto"]}
                    label={rightUnit ? { value: rightUnit, angle: 90, position: "insideRight", style: { fontSize: 11, fill: "var(--color-muted-foreground)" } } : undefined} />
                )}
                <Tooltip
                  cursor={{ stroke: "var(--color-border)" }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-sm">
                        <div className="mb-1 font-medium">{periodLabel(String(label), ok.freq)}</div>
                        {payload.map((p) => {
                          const k = String(p.dataKey), unit = lineUnit(k);
                          return (
                            <div key={k} className="flex items-center gap-2">
                              <span aria-hidden className="size-2 rounded-full" style={{ background: p.color }} />
                              <span className="text-muted-foreground">{byKey.get(k)?.label ?? k}</span>
                              <span className="ml-auto pl-3 font-medium tabular-nums">
                                {typeof p.value === "number" ? fmt(p.value) : "n/a"}{unit ? ` ${unit}` : ""}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  }}
                />
                <Legend iconType="plainline" iconSize={14} wrapperStyle={{ fontSize: 12 }} />
                {ok.keys.map((k) => {
                  const m = byKey.get(k);
                  return (
                    <Line key={k} dataKey={k} name={m?.label ?? k} yAxisId={ok.axis[k]} type="monotone"
                      stroke={COLORS[(m?.gi ?? 0) % COLORS.length]} strokeDasharray={DASH[m?.si ?? 0] || undefined} strokeWidth={2}
                      dot={dots ? { r: 2.5 } : false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <table className="sr-only">
            <caption>Latest value of each line</caption>
            <thead><tr><th scope="col">Line</th><th scope="col">Latest period</th><th scope="col">Value</th></tr></thead>
            <tbody>
              {ok.keys.map((k) => {
                const l = latest(k);
                return (
                  <tr key={k}>
                    <td>{byKey.get(k)?.label ?? k}</td>
                    <td>{l ? periodLabel(l.t, ok.freq) : "n/a"}</td>
                    <td>{l ? `${fmt(l.v)}${lineUnit(k) ? ` ${lineUnit(k)}` : ""}` : "n/a"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
