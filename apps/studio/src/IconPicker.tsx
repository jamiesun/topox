import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { listNodeIcons, resolveNodeIcon } from "@topox/editor";

const GROUP_LABELS: Record<string, string> = {
  net: "Network",
  app: "Application",
  device: "Device",
};

/** "net-loadbalancer" → "Loadbalancer", "app-web" → "Web". */
export function typeLabel(type: string): string {
  const rest = type.includes("-") ? type.slice(type.indexOf("-") + 1) : type;
  return rest
    .split("-")
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--overlay)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 60,
};

const panel: CSSProperties = {
  background: "var(--surface)",
  borderRadius: 10,
  boxShadow: "var(--shadow-panel)",
  width: 520,
  maxWidth: "calc(100vw - 48px)",
  maxHeight: "calc(100vh - 96px)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))",
  gap: 6,
};

const cellStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 5,
  padding: "10px 4px 8px",
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--surface)",
  cursor: "pointer",
  fontSize: 11,
  color: "var(--text-secondary)",
  lineHeight: 1.1,
};

/**
 * Modal grid over every registered node icon. Used both to insert nodes
 * (pick = node type) and to choose a node's icon in the inspector.
 */
export function IconPickerDialog({
  title,
  onPick,
  onClose,
  customLabel,
  customPlaceholder,
}: {
  title: string;
  onPick: (name: string) => void;
  onClose: () => void;
  /** When set, shows a freeform input + button for values outside the registry. */
  customLabel?: string;
  customPlaceholder?: string;
}) {
  const [filter, setFilter] = useState("");
  const [custom, setCustom] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups = useMemo(() => {
    const names = listNodeIcons()
      .filter((n) => n.toLowerCase().includes(filter.trim().toLowerCase()))
      .sort();
    const byPrefix = new Map<string, string[]>();
    for (const name of names) {
      const prefix = name.includes("-") ? name.slice(0, name.indexOf("-")) : "other";
      byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), name]);
    }
    return [...byPrefix.entries()];
  }, [filter]);

  const submitCustom = () => {
    const v = custom.trim();
    if (v !== "") onPick(v);
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div role="dialog" aria-label={title} style={panel} onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 14px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 13.5, flex: 1 }}>{title}</div>
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filter…"
            style={{
              border: "1px solid var(--border-strong)",
              borderRadius: 6,
              padding: "4px 8px",
              fontSize: 12.5,
              width: 150,
            }}
          />
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ border: "none", background: "none", cursor: "pointer", fontSize: 15, color: "var(--muted)" }}
          >
            ✕
          </button>
        </div>

        <div style={{ overflow: "auto", padding: 14 }}>
          {groups.length === 0 ? (
            <div style={{ color: "var(--muted-2)", fontSize: 12.5 }}>No icons match “{filter}”.</div>
          ) : (
            groups.map(([prefix, names]) => (
              <div key={prefix} style={{ marginBottom: 14 }}>
                <div
                  style={{
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: 0.6,
                    color: "var(--muted)",
                    fontWeight: 600,
                    marginBottom: 6,
                  }}
                >
                  {GROUP_LABELS[prefix] ?? prefix}
                </div>
                <div style={gridStyle}>
                  {names.map((name) => {
                    const render = resolveNodeIcon(name, name);
                    return (
                      <button key={name} title={name} aria-label={name} style={cellStyle} onClick={() => onPick(name)}>
                        <span style={{ display: "inline-flex", color: "var(--text-secondary)" }}>
                          {render !== undefined ? render({ width: 22, height: 22 }) : null}
                        </span>
                        {typeLabel(name)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {customLabel !== undefined ? (
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              padding: "10px 14px",
              borderTop: "1px solid var(--border)",
            }}
          >
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitCustom();
              }}
              placeholder={customPlaceholder ?? ""}
              style={{
                flex: 1,
                border: "1px solid var(--border-strong)",
                borderRadius: 6,
                padding: "5px 8px",
                fontSize: 12.5,
                fontFamily: "ui-monospace, monospace",
              }}
            />
            <button
              onClick={submitCustom}
              disabled={custom.trim() === ""}
              style={{
                border: "1px solid var(--border-strong)",
                borderRadius: 6,
                padding: "5px 12px",
                fontSize: 12.5,
                background: "var(--surface-2)",
                cursor: "pointer",
              }}
            >
              {customLabel}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
