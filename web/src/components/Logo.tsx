const NODES: [number, number][] = [[8, 10], [21, 8], [25, 20], [8, 24], [19, 25]];
const HUB: [number, number] = [15, 16];
const EDGES: [number, number][] = [[0, 5], [1, 5], [2, 5], [3, 5], [3, 4], [2, 4]];
const ALL = [...NODES, HUB];

/** The statmesh mark: a small mesh on an indigo tile. Also drawn by icon.svg, apple-icon and the OG image (same numbers). */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg aria-hidden viewBox="0 0 32 32" width={size} height={size} focusable="false">
      <rect width="32" height="32" rx="7" fill="#4F46E5" />
      <g stroke="#fff" strokeWidth="2" strokeLinecap="round">
        {EDGES.map(([a, b]) => <line key={`${a}-${b}`} x1={ALL[a][0]} y1={ALL[a][1]} x2={ALL[b][0]} y2={ALL[b][1]} />)}
      </g>
      {NODES.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2.6" fill="#fff" />)}
      <circle cx={HUB[0]} cy={HUB[1]} r="3.2" fill="#F59E0B" />
    </svg>
  );
}

export function Logo() {
  return <span className="flex items-center gap-2"><Mark />statmesh</span>;
}
