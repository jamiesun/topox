import { useEffect, useRef, useState, type CSSProperties } from "react";

export interface DropdownItem {
  label: string;
  hint?: string;
  disabled?: boolean;
  onSelect: () => void;
}

const menuStyles: Record<string, CSSProperties> = {
  wrap: { position: "relative", display: "inline-block" },
  menu: {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    minWidth: 168,
    background: "#fff",
    border: "1px solid #d0d7de",
    borderRadius: 8,
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)",
    padding: 4,
    zIndex: 50,
  },
  item: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    width: "100%",
    border: "none",
    background: "transparent",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 12.5,
    cursor: "pointer",
    textAlign: "left" as const,
  },
  hint: { color: "#94a3b8", fontSize: 11 },
};

/** Minimal toolbar dropdown: closes on outside click, Escape, or selection. */
export function Dropdown({
  label,
  items,
  buttonStyle,
}: {
  label: string;
  items: DropdownItem[];
  buttonStyle: CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Capture-phase click: works for real pointers, programmatic .click(),
    // and elements that stop propagation.
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} style={menuStyles.wrap}>
      <button
        style={{ ...buttonStyle, ...(open ? { background: "#f1f5f9" } : {}) }}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label} ▾
      </button>
      {open ? (
        <div style={menuStyles.menu} role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              disabled={item.disabled ?? false}
              style={{
                ...menuStyles.item,
                ...(item.disabled ? { color: "#cbd5e1", cursor: "default" } : {}),
              }}
              onMouseEnter={(e) => {
                if (!item.disabled) e.currentTarget.style.background = "#f1f5f9";
              }}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              onClick={() => {
                if (item.disabled) return;
                setOpen(false);
                item.onSelect();
              }}
            >
              <span>{item.label}</span>
              {item.hint ? <span style={menuStyles.hint}>{item.hint}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
