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
  "var(--surface-inset-base)": "#1f2530",
  "var(--surface-base)": "#262c38",
};

function resolveColor(color: string): string {
  return COLOR_MAP[color] ?? color;
}

interface ProgressRingProps {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  label?: string;
  sublabel?: string;
  showPercent?: boolean;
}

export default function ProgressRing({
  value,
  max = 100,
  size = 64,
  strokeWidth = 5,
  color = "var(--holos-accent)",
  trackColor = "var(--surface-inset-base)",
  label,
  sublabel,
  showPercent = false,
}: ProgressRingProps) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct);
  const stroke = resolveColor(color);
  const track = resolveColor(trackColor);

  return (
    <div class="holos-ring" style={{ width: `${size}px`, height: `${size}px` }}>
      <svg width={size} height={size} class="holos-ring__svg" role="img" aria-label="Progress">
        <title>Progress</title>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={track} stroke-width={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={stroke}
          stroke-width={strokeWidth}
          stroke-linecap="round"
          stroke-dasharray={String(circumference)}
          stroke-dashoffset={offset}
          style={{ filter: `drop-shadow(0 0 6px ${stroke}66)` }}
        />
      </svg>
      <div class="holos-ring__center">
        {label !== undefined ? (
          <span class="holos-ring__label" style={{ "font-size": size <= 48 ? "11px" : size <= 64 ? "13px" : "15px" }}>
            {label}
          </span>
        ) : showPercent ? (
          <span class="holos-ring__label" style={{ "font-size": size <= 48 ? "11px" : "13px" }}>
            {Math.round(pct * 100)}%
          </span>
        ) : null}
        {sublabel && <span class="holos-ring__sublabel">{sublabel}</span>}
      </div>
    </div>
  );
}
