// Inline Lucide icons — replaces lucide-solid (73MB) for startup perf.
// Paths from lucide.dev (MIT). All: 24x24 viewBox, stroke-based.
import type { Component } from "solid-js";

type IconProps = { size?: number; class?: string };

const S = (size: number, cls: string | undefined, children: any) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={cls}
  >
    {children}
  </svg>
);

export const LayoutPanelLeft: Component<IconProps> = (p) => S(p.size ?? 24, p.class, <>
  <rect width="7" height="18" x="3" y="3" rx="1" />
  <rect width="7" height="7" x="14" y="3" rx="1" />
  <rect width="7" height="7" x="14" y="14" rx="1" />
</>);

export const GitBranch: Component<IconProps> = (p) => S(p.size ?? 24, p.class, <>
  <line x1="6" x2="6" y1="3" y2="15" />
  <circle cx="18" cy="6" r="3" />
  <circle cx="6" cy="18" r="3" />
  <path d="M18 9a9 9 0 0 1-9 9" />
</>);

export const GitCompare: Component<IconProps> = (p) => S(p.size ?? 24, p.class, <>
  <circle cx="18" cy="18" r="3" />
  <circle cx="6" cy="6" r="3" />
  <path d="M13 6h3a2 2 0 0 1 2 2v7" />
  <path d="M11 18H8a2 2 0 0 1-2-2V9" />
</>);

export const FolderTree: Component<IconProps> = (p) => S(p.size ?? 24, p.class, <>
  <path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" />
  <path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" />
  <path d="M3 5c0 4.929 4 5 4 10" />
  <path d="M3 21v-5" />
  <path d="M3 16v-5.03" />
</>);

export const Terminal: Component<IconProps> = (p) => S(p.size ?? 24, p.class, <>
  <polyline points="4 17 10 11 4 5" />
  <line x1="12" x2="20" y1="19" y2="19" />
</>);

export const Sun: Component<IconProps> = (p) => S(p.size ?? 24, p.class, <>
  <circle cx="12" cy="12" r="4" />
  <path d="M12 2v2" />
  <path d="M12 20v2" />
  <path d="m4.93 4.93 1.41 1.41" />
  <path d="m17.66 17.66 1.41 1.41" />
  <path d="M2 12h2" />
  <path d="M20 12h2" />
  <path d="m6.34 17.66-1.41 1.41" />
  <path d="m19.07 4.93-1.41 1.41" />
</>);

export const Moon: Component<IconProps> = (p) => S(p.size ?? 24, p.class, <>
  <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
</>);

export const Settings: Component<IconProps> = (p) => S(p.size ?? 24, p.class, <>
  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
  <circle cx="12" cy="12" r="3" />
</>);

export const Bot: Component<IconProps> = (p) => S(p.size ?? 24, p.class, <>
  <path d="M12 8V4H8" />
  <rect width="16" height="12" x="4" y="8" rx="2" />
  <path d="M2 14h2" />
  <path d="M20 14h2" />
  <path d="M15 13v2" />
  <path d="M9 13v2" />
</>);

export const PanelLeftClose: Component<IconProps> = (p) => S(p.size ?? 24, p.class, <>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M9 3v18" />
  <path d="m16 15-3-3 3-3" />
</>);

export const PanelLeftOpen: Component<IconProps> = (p) => S(p.size ?? 24, p.class, <>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M9 3v18" />
  <path d="m14 9 3 3-3 3" />
</>);

export const Keyboard: Component<IconProps> = (p) => S(p.size ?? 24, p.class, <>
  <rect width="20" height="16" x="2" y="4" rx="2" />
  <path d="M6 8h.01" /><path d="M10 8h.01" /><path d="M14 8h.01" />
  <path d="M18 8h.01" /><path d="M8 12h.01" /><path d="M12 12h.01" />
  <path d="M16 12h.01" /><path d="M7 16h10" />
</>);

export const Monitor: Component<IconProps> = (p) => S(p.size ?? 24, p.class, <>
  <rect width="20" height="14" x="2" y="3" rx="2" />
  <path d="M8 21h8" />
  <path d="M12 17v4" />
</>);

// ── Model icon candidates ─────────────────────────────────────────────────────

export const Cpu: Component<IconProps> = (p) => S(p.size ?? 24, p.class, <>
  <rect x="4" y="4" width="16" height="16" rx="2" />
  <rect x="9" y="9" width="6" height="6" />
  <path d="M15 2v2" /><path d="M15 20v2" />
  <path d="M2 15h2" /><path d="M2 9h2" />
  <path d="M20 15h2" /><path d="M20 9h2" />
  <path d="M9 2v2" /><path d="M9 20v2" />
</>);

export const Atom: Component<IconProps> = (p) => S(p.size ?? 24, p.class, <>
  <circle cx="12" cy="12" r="1" />
  <path d="M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z" />
  <path d="M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5Z" />
</>);

export const Aperture: Component<IconProps> = (p) => S(p.size ?? 24, p.class, <>
  <circle cx="12" cy="12" r="10" />
  <path d="m14.31 8 5.74 9.94" />
  <path d="M9.69 8h11.48" />
  <path d="m7.38 12 5.74-9.94" />
  <path d="M9.69 16 3.95 6.06" />
  <path d="M14.31 16H2.83" />
  <path d="m16.62 12-5.74 9.94" />
</>);

export const CircuitBoard: Component<IconProps> = (p) => S(p.size ?? 24, p.class, <>
  <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M11 9h4a2 2 0 0 0 2-2V3" />
  <circle cx="9" cy="9" r="2" />
  <path d="M7 21v-4a2 2 0 0 1 2-2h4" />
  <circle cx="15" cy="15" r="2" />
</>);

export const BrainCircuit: Component<IconProps> = (p) => S(p.size ?? 24, p.class, <>
  <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
  <path d="M9 13a4.5 4.5 0 0 0 3-4" />
  <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
  <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
  <path d="M6 18a4 4 0 0 1-1.967-.516" />
  <path d="M12 13h4" />
  <path d="M12 18h6a2 2 0 0 1 2 2v1" />
  <path d="M12 8h8" />
  <path d="M16 8V5a2 2 0 0 1 2-2" />
  <circle cx="16" cy="13" r=".5" />
  <circle cx="18" cy="3" r=".5" />
  <circle cx="20" cy="21" r=".5" />
  <circle cx="20" cy="8" r=".5" />
</>);
