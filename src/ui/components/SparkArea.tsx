import { createUniqueId } from "solid-js";

/** Resolve CSS variable or passthrough hex to a concrete hex value for SVG rendering */
const COLOR_MAP: Record<string, string> = {
  "var(--holos-accent)": "#5aa6f0",
  "var(--holos-info)": "#a78bfa",
  "var(--holos-warning)": "#fbbf24",
  "var(--holos-success)": "#34d399",
  "var(--holos-danger)": "#f87171",
  "var(--holos-cyan)": "#2dd4bf",
  "var(--holos-magenta)": "#e879f9",
  "var(--text-strong)": "#eaeef4",
  "var(--text-subtle)": "#8b949e",
  "var(--text-weaker)": "#5b6472",
};

function resolveColor(color: string): string {
  return COLOR_MAP[color] ?? color;
}

interface SparkAreaProps {
  data: number[];
  color?: string;
  height?: number;
  gradientId?: string;
}

export default function SparkArea({ data, color = "var(--holos-accent)", height = 28, gradientId }: SparkAreaProps) {
  const uid = createUniqueId();
  const safeId = gradientId ?? `holos-spark-${uid}`;
  const width = 100;
  const points = data.length > 0 ? data : [0, 0];
  const resolved = resolveColor(color);

  const max = Math.max(...points, 1);
  const coords = points.map((v, i) => {
    const x = points.length > 1 ? (i / (points.length - 1)) * width : width / 2;
    const y = height - (v / max) * (height - 2) - 1;
    return { x, y };
  });
  const line = coords.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const id = safeId.replace(/[^a-zA-Z0-9_-]/g, "");

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      class="holos-spark"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color={resolved} stop-opacity={0.5} />
          <stop offset="100%" stop-color={resolved} stop-opacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={resolved} stroke-width={1.5} vector-effect="non-scaling-stroke" />
    </svg>
  );
}
