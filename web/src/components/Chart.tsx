import { formatValue } from "@/lib/format";

const COLORS = ["#1d4ed8", "#b91c1c", "#047857", "#7c3aed", "#b45309", "#0e7490", "#be185d", "#4d7c0f"];
const MAX_LINES = 8;
const W = 640, H = 260, L = 64, R = 12, T = 12, B = 28;

/** Inline-SVG line chart, one line per geo. The table below is the accessible equivalent. */
export function Chart({ columns, rows, unit }: { columns: string[]; rows: unknown[][]; unit: string }) {
  const ix = columns.indexOf("period_start"), iy = columns.indexOf("value"), ig = columns.indexOf("geo");
  const lines = new Map<string, [number, number][]>();
  for (const r of rows) {
    const y = r[iy], x = Date.parse(String(r[ix]));
    if (typeof y !== "number" || Number.isNaN(x)) continue;
    const g = ig >= 0 ? String(r[ig]) : "series";
    lines.set(g, [...(lines.get(g) ?? []), [x, y]]);
  }
  const shown = [...lines.entries()].slice(0, MAX_LINES);
  const pts = shown.flatMap(([, p]) => p);
  if (!pts.length) return <p className="text-slate-600">No numeric observations to chart.</p>;

  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sx = (x: number) => L + ((x - x0) / (x1 - x0 || 1)) * (W - L - R);
  const sy = (y: number) => H - B - ((y - y0) / (y1 - y0 || 1)) * (H - B - T);
  const ticks = [0, 1, 2, 3].map((i) => y0 + ((y1 - y0) * i) / 3);
  const year = (t: number) => new Date(t).toISOString().slice(0, 10);
  const label = `Line chart of ${unit}, ${year(x0)} to ${year(x1)}, ${shown.length} series`;

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="w-full max-w-3xl">
        <title>{label}</title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} stroke="#cbd5e1" />
            <text x={L - 4} y={sy(t) + 4} textAnchor="end" fontSize="11" fill="#334155">
              {t.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </text>
          </g>
        ))}
        <text x={L} y={H - 8} fontSize="11" fill="#334155">{year(x0)}</text>
        <text x={W - R} y={H - 8} fontSize="11" fill="#334155" textAnchor="end">{year(x1)}</text>
        {shown.map(([g, p], i) => (
          <polyline key={g} fill="none" stroke={COLORS[i]} strokeWidth="2"
            points={p.map(([x, y]) => `${sx(x)},${sy(y)}`).join(" ")}>
            <title>{g}</title>
          </polyline>
        ))}
      </svg>
      <figcaption className="text-sm text-slate-700">
        <span className="mr-3">y axis: {unit}</span>
        {shown.map(([g], i) => (
          <span key={g} className="mr-3 whitespace-nowrap">
            <span aria-hidden style={{ color: COLORS[i] }}>■</span> {g}
          </span>
        ))}
        {lines.size > MAX_LINES && <span>(first {MAX_LINES} of {lines.size} geos charted)</span>}
        <span className="block">Range {formatValue(y0, unit)} to {formatValue(y1, unit)}.</span>
      </figcaption>
    </figure>
  );
}
