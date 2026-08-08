import type { JSX } from "solid-js";

export type IconName =
  | "activity"
  | "alert"
  | "arrowRight"
  | "ban"
  | "book"
  | "bulb"
  | "check"
  | "checkCircle"
  | "chevronDown"
  | "chevronRight"
  | "circle"
  | "clock"
  | "compass"
  | "cpu"
  | "eye"
  | "file"
  | "flag"
  | "flask"
  | "gitBranch"
  | "help"
  | "history"
  | "image"
  | "list"
  | "milestone"
  | "minusCircle"
  | "network"
  | "package"
  | "pause"
  | "pencil"
  | "play"
  | "plus"
  | "refresh"
  | "send"
  | "shield"
  | "spark"
  | "sticky"
  | "target"
  | "undo"
  | "workflow"
  | "x"
  | "xCircle"
  | "zap";

/**
 * Icon path factories — each entry returns a FRESH element tree per call.
 *
 * Do NOT hoist these to shared module-level elements: Solid moves a shared
 * node from its previous parent when rendering the same icon twice, so the
 * earlier icon would disappear (observed as missing icons in Timeline nodes
 * and Journal entries). Factory functions guarantee one node per instance.
 */
const PATHS: Record<IconName, () => JSX.Element> = {
  activity: () => (
    <>
      <polyline points="2 12 6 12 9 4 15 20 18 12 22 12" />
    </>
  ),
  alert: () => (
    <>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  arrowRight: () => (
    <>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </>
  ),
  ban: () => (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m4.9 4.9 14.2 14.2" />
    </>
  ),
  book: () => (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </>
  ),
  bulb: () => (
    <>
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.4 1 2.3h6c0-.9.4-1.8 1-2.3A7 7 0 0 0 12 2z" />
    </>
  ),
  check: () => (
    <>
      <polyline points="20 6 9 17 4 12" />
    </>
  ),
  checkCircle: () => (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  chevronDown: () => (
    <>
      <polyline points="6 9 12 15 18 9" />
    </>
  ),
  chevronRight: () => (
    <>
      <polyline points="9 18 15 12 9 6" />
    </>
  ),
  circle: () => (
    <>
      <circle cx="12" cy="12" r="10" />
    </>
  ),
  clock: () => (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
  compass: () => (
    <>
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </>
  ),
  cpu: () => (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" />
    </>
  ),
  eye: () => (
    <>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  file: () => (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </>
  ),
  flag: () => (
    <>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </>
  ),
  flask: () => (
    <>
      <path d="M10 2v6L4.5 17.5A2 2 0 0 0 6.2 20h11.6a2 2 0 0 0 1.7-2.5L14 8V2" />
      <path d="M8 2h8" />
    </>
  ),
  gitBranch: () => (
    <>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </>
  ),
  help: () => (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </>
  ),
  history: () => (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </>
  ),
  image: () => (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </>
  ),
  list: () => (
    <>
      <rect x="3" y="5" width="6" height="6" rx="1" />
      <path d="m3 17 2 2 4-4" />
      <path d="M13 6h8M13 12h8M13 18h8" />
    </>
  ),
  milestone: () => (
    <>
      <path d="M18 6H5a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h13l4-3.5Z" />
      <path d="M12 13v8" />
      <path d="M12 3v3" />
    </>
  ),
  minusCircle: () => (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12h8" />
    </>
  ),
  network: () => (
    <>
      <rect x="9" y="2" width="6" height="6" rx="1" />
      <rect x="2" y="16" width="6" height="6" rx="1" />
      <rect x="16" y="16" width="6" height="6" rx="1" />
      <path d="M12 8v4M12 12H5v4M12 12h7v4" />
    </>
  ),
  package: () => (
    <>
      <path d="M20.91 8.84 21 9v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9l.09-.16a2 2 0 0 1 1.16-1.16l6-2.4a2 2 0 0 1 1.5 0l6 2.4a2 2 0 0 1 1.16 1.16z" />
      <path d="M3.5 8.5 12 12l8.5-3.5" />
      <path d="M12 12v9" />
    </>
  ),
  pause: () => (
    <>
      <rect x="14" y="4" width="4" height="16" rx="1" />
      <rect x="6" y="4" width="4" height="16" rx="1" />
    </>
  ),
  pencil: () => (
    <>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </>
  ),
  play: () => (
    <>
      <polygon points="6 3 20 12 6 21 6 3" />
    </>
  ),
  plus: () => (
    <>
      <path d="M12 5v14M5 12h14" />
    </>
  ),
  refresh: () => (
    <>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </>
  ),
  send: () => (
    <>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </>
  ),
  shield: () => (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </>
  ),
  spark: () => (
    <>
      <path d="M12 3l1.9 5.7L19.6 10.6l-5.7 1.9L12 18.2l-1.9-5.7L4.4 10.6l5.7-1.9Z" />
    </>
  ),
  sticky: () => (
    <>
      <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8z" />
      <polyline points="16 3 16 8 21 8" />
    </>
  ),
  target: () => (
    <>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
  undo: () => (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />
    </>
  ),
  workflow: () => (
    <>
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <path d="M7 11v4a2 2 0 0 0 2 2h4" />
      <rect x="13" y="13" width="8" height="8" rx="2" />
    </>
  ),
  x: () => (
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
  xCircle: () => (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6M9 9l6 6" />
    </>
  ),
  zap: () => (
    <>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </>
  ),
};

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export default function Icon({ name, size = 14, color = "currentColor", strokeWidth = 2 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      class="holos-icon"
      aria-hidden="true"
    >
      {PATHS[name]()}
    </svg>
  );
}
