import type { ReactElement, SVGProps } from "react";

/**
 * Node icon registry.
 *
 * The document only ever stores an icon *name* (`Node.icon`, an opaque
 * JSON-safe string) or nothing at all — SVG markup never enters TopoDoc,
 * diffs or exports. Rendering resolves that name here:
 *
 *   1. `node.icon` — explicit name, looked up in the registry
 *   2. `node.type` — every registered icon name doubles as a type default
 *   3. no match — the node renders without an icon (same as before)
 *
 * Hosts extend the vocabulary at runtime with `registerNodeIcon(name, render)`;
 * the renderer receives standard SVG props (size/color are applied via
 * width/height/currentColor), so any inline path set works.
 */
export type NodeIconRenderer = (props: SVGProps<SVGSVGElement>) => ReactElement;

const registry = new Map<string, NodeIconRenderer>();

/** Registers (or overrides) an icon renderer under a name. */
export function registerNodeIcon(name: string, render: NodeIconRenderer): void {
  registry.set(name, render);
}

/** Resolution order: explicit icon name first, then the node type. */
export function resolveNodeIcon(
  icon: string | undefined,
  nodeType: string,
): NodeIconRenderer | undefined {
  if (icon !== undefined) {
    const named = registry.get(icon);
    if (named) return named;
  }
  return registry.get(nodeType);
}

/** Whether a name is registered — lets callers distinguish names from literal glyphs. */
export function hasNodeIcon(name: string): boolean {
  return registry.has(name);
}

/** Names currently registered — useful for pickers. */
export function listNodeIcons(): string[] {
  return [...registry.keys()];
}

// ---------------------------------------------------------------------------
// Built-in icons (24×24 viewBox, stroke = currentColor). Hand-drawn primitives
// so the editor ships with zero icon dependencies.
// ---------------------------------------------------------------------------

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function svg(children: ReactElement | ReactElement[], props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} width={14} height={14} aria-hidden {...props}>
      {children}
    </svg>
  );
}

registerNodeIcon("net-router", (p) =>
  svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 10h5m0 0-2-2m2 2-2 2M16 14h-5m0 0 2-2m-2 2 2 2" />
    </>,
    p,
  ),
);

registerNodeIcon("net-switch", (p) =>
  svg(
    <>
      <rect x="3" y="8" width="18" height="8" rx="2" />
      <path d="M7 12h.01M11 12h.01M15 12h.01" />
    </>,
    p,
  ),
);

registerNodeIcon("net-firewall", (p) =>
  svg(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M3 14.5h18M9.5 5v5M14.5 10v4.5M9.5 14.5V19" />
    </>,
    p,
  ),
);

registerNodeIcon("net-server", (p) =>
  svg(
    <>
      <rect x="4" y="4" width="16" height="7" rx="1.5" />
      <rect x="4" y="13" width="16" height="7" rx="1.5" />
      <path d="M8 7.5h.01M8 16.5h.01" />
    </>,
    p,
  ),
);

registerNodeIcon("net-database", (p) =>
  svg(
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.6" />
      <path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6" />
    </>,
    p,
  ),
);

registerNodeIcon("net-cloud", (p) =>
  svg(
    <path d="M7 18a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 8.6 4.2 4.2 0 0 1 16.8 17L7 18Z" />,
    p,
  ),
);

registerNodeIcon("net-cpe", (p) =>
  svg(
    <>
      <rect x="4" y="13" width="16" height="6" rx="1.5" />
      <path d="M8 16h.01M12 9a6 6 0 0 1 8 0M14 12a3 3 0 0 1 4 0" />
    </>,
    p,
  ),
);

registerNodeIcon("net-wifi", (p) =>
  svg(
    <>
      <path d="M4 9.5a12 12 0 0 1 16 0M7 13a8 8 0 0 1 10 0M9.8 16.2a4 4 0 0 1 4.4 0" />
      <path d="M12 19.5h.01" />
    </>,
    p,
  ),
);

registerNodeIcon("net-terminal", (p) =>
  svg(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m7 9 3 3-3 3M12.5 15H17" />
    </>,
    p,
  ),
);

registerNodeIcon("net-mikrotik", (p) =>
  svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 10h5m0 0-2-2m2 2-2 2M16 14h-5m0 0 2-2m-2 2 2 2" />
    </>,
    p,
  ),
);

registerNodeIcon("net-container", (p) =>
  svg(
    <>
      <rect x="4" y="12.5" width="7" height="7" rx="1" />
      <rect x="13" y="12.5" width="7" height="7" rx="1" />
      <rect x="8.5" y="4" width="7" height="7" rx="1" />
    </>,
    p,
  ),
);

registerNodeIcon("net-loadbalancer", (p) =>
  svg(
    <>
      <circle cx="12" cy="5" r="2.4" />
      <path d="M12 7.4v3.1m0 0L5.5 14m6.5-3.5V14m0-3.5 6.5 3.5" />
      <circle cx="5.5" cy="17" r="2.2" />
      <circle cx="12" cy="17" r="2.2" />
      <circle cx="18.5" cy="17" r="2.2" />
    </>,
    p,
  ),
);

registerNodeIcon("net-gateway", (p) =>
  svg(
    <>
      <path d="M4 20v-8a8 8 0 0 1 16 0v8" />
      <path d="M9.5 20v-5a2.5 2.5 0 0 1 5 0v5M3 20h18" />
    </>,
    p,
  ),
);

registerNodeIcon("net-vpn", (p) =>
  svg(
    <>
      <path d="m12 3 7 3v5.5c0 4.4-3 7.4-7 9-4-1.6-7-4.6-7-9V6l7-3Z" />
      <circle cx="12" cy="10.5" r="1.8" />
      <path d="M12 12.3V15" />
    </>,
    p,
  ),
);

registerNodeIcon("net-dns", (p) =>
  svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.4 3.8 5.6 3.8 9s-1.3 6.6-3.8 9c-2.5-2.4-3.8-5.6-3.8-9S9.5 5.4 12 3Z" />
    </>,
    p,
  ),
);

registerNodeIcon("net-storage", (p) =>
  svg(
    <>
      <rect x="4" y="4" width="16" height="4.6" rx="1" />
      <rect x="4" y="9.7" width="16" height="4.6" rx="1" />
      <rect x="4" y="15.4" width="16" height="4.6" rx="1" />
      <path d="M7.5 6.3h.01M7.5 12h.01M7.5 17.7h.01" />
    </>,
    p,
  ),
);

registerNodeIcon("app-web", (p) =>
  svg(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 8.5h18M6.3 6.3h.01M9 6.3h.01" />
    </>,
    p,
  ),
);

registerNodeIcon("app-backend", (p) =>
  svg(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m9.5 10-2.5 2 2.5 2m5-4 2.5 2-2.5 2" />
    </>,
    p,
  ),
);

registerNodeIcon("app-mobile", (p) =>
  svg(
    <>
      <rect x="8" y="3" width="8" height="18" rx="2" />
      <path d="M11 17.8h2" />
    </>,
    p,
  ),
);

registerNodeIcon("app-api", (p) =>
  svg(
    <>
      <path d="M9 7.5V4M15 7.5V4" />
      <path d="M7 7.5h10V12a5 5 0 0 1-10 0V7.5Z" />
      <path d="M12 17v3.5" />
    </>,
    p,
  ),
);

registerNodeIcon("app-agent", (p) =>
  svg(
    <>
      <rect x="5" y="8" width="14" height="10" rx="2.5" />
      <path d="M12 8V5.5M9.5 12.5h.01M14.5 12.5h.01M9.5 15.3h5" />
      <circle cx="12" cy="4.2" r="1.2" />
    </>,
    p,
  ),
);

registerNodeIcon("app-queue", (p) =>
  svg(
    <>
      <path d="M4 7h10M4 12h10M4 17h10" />
      <path d="m17 9.5 3 2.5-3 2.5" />
    </>,
    p,
  ),
);

registerNodeIcon("app-cache", (p) =>
  svg(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m13 8-3.6 4.6h3.8L11 16" />
    </>,
    p,
  ),
);

registerNodeIcon("app-scheduler", (p) =>
  svg(
    <>
      <circle cx="12" cy="13" r="7.5" />
      <path d="M12 9.5V13l2.6 1.8M5.5 4.5 3.5 6.5M18.5 4.5l2 2" />
    </>,
    p,
  ),
);

registerNodeIcon("app-function", (p) =>
  svg(
    <>
      <path d="M7.5 5c2.4 0 3 1.4 4 4.1L15.5 19" />
      <path d="M12.4 12.2 8.5 19" />
    </>,
    p,
  ),
);

registerNodeIcon("app-desktop", (p) =>
  svg(
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M9.5 20h5M12 16v4" />
    </>,
    p,
  ),
);

registerNodeIcon("device-sensor", (p) =>
  svg(
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8" />
    </>,
    p,
  ),
);

registerNodeIcon("device-monitor", (p) =>
  svg(
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M6 10h2.5L10 7.5l3 5 1.5-2.5H18" />
      <path d="M9.5 20h5M12 16v4" />
    </>,
    p,
  ),
);

registerNodeIcon("device-camera", (p) =>
  svg(
    <>
      <rect x="3" y="6.5" width="13" height="9" rx="2" />
      <path d="m16 10 5-2.8v7.6L16 12" />
      <path d="M6.5 18.5V16" />
    </>,
    p,
  ),
);

registerNodeIcon("device-laptop", (p) =>
  svg(
    <>
      <rect x="5" y="5" width="14" height="10" rx="1.5" />
      <path d="M2.5 19h19l-2.5-4M5 15l-2.5 4" />
    </>,
    p,
  ),
);

registerNodeIcon("device-printer", (p) =>
  svg(
    <>
      <path d="M7 8V3.5h10V8" />
      <rect x="4" y="8" width="16" height="8" rx="1.5" />
      <path d="M7 13.5h10v7H7v-7ZM17 11h.01" />
    </>,
    p,
  ),
);

registerNodeIcon("device-iot", (p) =>
  svg(
    <>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M9.5 4v3M14.5 4v3M9.5 17v3M14.5 17v3M4 9.5h3M4 14.5h3M17 9.5h3M17 14.5h3" />
    </>,
    p,
  ),
);
