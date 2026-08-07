import { For } from "solid-js";

/** Resolve CSS variable or passthrough hex to a concrete hex value for SVG rendering */
const COLOR_MAP: Record<string, string> = {
  "var(--holos-accent)": "#5aa6f0",
  "var(--holos-success)": "#34d399",
  "var(--holos-danger)": "#f87171",
  "var(--holos-warning)": "#fbbf24",
  "var(--holos-info)": "#a78bfa",
  "var(--holos-cyan)": "#2dd4bf",
  "var(--text-subtle)": "#8b949e",
  "var(--border-base)": "#30363d",
};

function resolveColor(color: string): string {
  return COLOR_MAP[color] ?? color;
}

interface StoryRadarProps {
  scores: Record<string, number>;
  color?: string;
  height?: number;
}

export default function StoryRadar({ scores, color = "var(--holos-accent)", height = 180 }: StoryRadarProps) {
  const entries = Object.entries(scores).filter(([, v]) => typeof v === "number" && Number.isFinite(v));
  if (entries.length < 3) return null;

  const cx = 100;
  const cy = 100;
  const radius = 68;
  const max = Math.max(...entries.map(([, v]) => v), 1);
  const upper = Math.ceil(max);
  const resolved = resolveColor(color);

  const angleFor = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / entries.length;
  const pointFor = (i: number, value: number) => {
    const r = Math.max(0, Math.min(1, value / upper)) * radius;
    return { x: cx + r * Math.cos(angleFor(i)), y: cy + r * Math.sin(angleFor(i)) };
  };

  const gridRings = [0.25, 0.5, 0.75, 1].map(
    (f) =>
      entries
        .map((_, i) => {
          const p = pointFor(i, upper * f);
          return `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`;
        })
        .join(" ") + " Z",
  );

  const axes = entries.map(([name], i) => {
    const p = pointFor(i, upper);
    const labelR = radius + 16;
    const lp = {
      x: cx + labelR * Math.cos(angleFor(i)),
      y: cy + labelR * Math.sin(angleFor(i)),
    };
    return { name, p, lp };
  });

  const polygon =
    entries
      .map(([, v], i) => {
        const p = pointFor(i, v);
        return `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`;
      })
      .join(" ") + " Z";

  return (
    <svg
      viewBox={`0 0 ${cx * 2} ${cy * 2}`}
      width="100%"
      height={height}
      class="holos-radar"
      role="img"
      aria-label="Story spine score radar"
    >
      <g stroke="#30363d" stroke-opacity={0.6} fill="none">
        <For each={gridRings}>{(d) => <path d={d} />}</For>
      </g>
      <For each={axes}>
        {(a) => (
          <g>
            <line x1={cx} y1={cy} x2={a.p.x} y2={a.p.y} stroke="#30363d" stroke-opacity={0.35} />
            <text
              x={a.lp.x}
              y={a.lp.y}
              text-anchor={Math.abs(a.lp.x - cx) < 1 ? "middle" : a.lp.x > cx ? "start" : "end"}
              dominant-baseline="middle"
              fill="#8b949e"
              font-size="9"
              font-family="var(--font-family-mono)"
            >
              {a.name}
            </text>
          </g>
        )}
      </For>
      <polygon points={polygon} fill={resolved} fill-opacity={0.18} stroke={resolved} stroke-width={1.5} />
    </svg>
  );
}
