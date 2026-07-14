import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type {
  AttrValue,
  Attrs,
  Edge,
  GraphDiff,
  Group,
  Node,
  NodeRuntimeHistoryEntry,
  NodeRuntime,
  NodeStyle,
  TopoDoc,
} from "@topox/core";
import { makeEdgeUpdate, makeGroupUpdate, makeNodeUpdate } from "@topox/core";
import { statusPalette } from "@topox/editor";
import { IconPickerDialog } from "./IconPicker.js";

const card: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: 10,
};

const inputStyle: CSSProperties = {
  width: "100%",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "4px 8px",
  boxSizing: "border-box",
  fontSize: 12.5,
  fontFamily: "inherit",
};

const labelStyle: CSSProperties = { display: "block", marginTop: 8, color: "var(--muted)" };

/** Titled section with a top divider; keeps the panel scannable. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 12, borderTop: "1px solid var(--border-soft)", paddingTop: 8 }}>
      <div
        style={{
          fontSize: 10.5,
          textTransform: "uppercase",
          letterSpacing: 0.7,
          color: "var(--muted-2)",
          fontWeight: 700,
          marginBottom: 2,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

/** Two fields side by side. */
function Row2({ children }: { children: ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 8 }}>{children}</div>;
}

const smallBtn: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--surface)",
  cursor: "pointer",
  fontSize: 11.5,
  padding: "3px 8px",
  color: "var(--text-secondary)",
};

/**
 * Text input holding a local draft; commits on blur or Enter. One diff per
 * edit gesture instead of one per keystroke, so undo history stays sane.
 */
function DraftField({
  value,
  onCommit,
  placeholder,
  mono = false,
}: {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <input
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value);
      }}
      style={{ ...inputStyle, ...(mono ? { fontFamily: "ui-monospace, monospace" } : {}) }}
    />
  );
}

/** Icon field: freeform input (emoji ok) plus a popup grid over the registry. */
function IconField({ value, onCommit }: { value: string; onCommit: (next: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <div style={{ flex: 1 }}>
        <DraftField value={value} onCommit={onCommit} placeholder="e.g. net-router or 🔥" mono />
      </div>
      <button
        onClick={() => setOpen(true)}
        style={{
          border: "1px solid var(--border-strong)",
          borderRadius: 6,
          background: "var(--surface-2)",
          padding: "4px 10px",
          fontSize: 12,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        Pick…
      </button>
      {open ? (
        <IconPickerDialog
          title="Choose icon"
          customLabel="Use value"
          customPlaceholder="emoji or short text, e.g. 🔥"
          onPick={(name) => {
            onCommit(name);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

/** One color property row: swatch picker + clear back to theme default. */
function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (next: string | undefined) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
      <span style={{ color: "var(--muted)", width: 62, flexShrink: 0 }}>{label}</span>
      <input
        type="color"
        aria-label={`${label} color`}
        value={value ?? "#ffffff"}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: 34,
          height: 22,
          padding: 1,
          border: "1px solid var(--border)",
          borderRadius: 4,
          background: "var(--surface)",
          cursor: "pointer",
        }}
      />
      <code style={{ fontSize: 11, color: value !== undefined ? "var(--text-secondary)" : "var(--muted-2)" }}>
        {value ?? "default"}
      </code>
      {value !== undefined ? (
        <button style={{ ...smallBtn, marginLeft: "auto" }} onClick={() => onChange(undefined)}>
          reset
        </button>
      ) : null}
    </div>
  );
}

const selectStyle: CSSProperties = {
  ...inputStyle,
  padding: "3px 6px",
  cursor: "pointer",
};

/**
 * NodeStyle editor — border, background and font overrides. Emits the whole
 * style bag per change; an empty bag deletes the field (back to theme).
 */
function StyleEditor({
  style,
  onCommit,
}: {
  style: NodeStyle | undefined;
  onCommit: (next: NodeStyle | undefined) => void;
}) {
  const set = (patch: Partial<Record<keyof NodeStyle, NodeStyle[keyof NodeStyle] | undefined>>) => {
    const next: Record<string, unknown> = { ...style };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    onCommit(Object.keys(next).length === 0 ? undefined : (next as NodeStyle));
  };
  return (
    <div>
      <ColorRow label="background" value={style?.fill} onChange={(v) => set({ fill: v })} />
      <ColorRow label="border" value={style?.stroke} onChange={(v) => set({ stroke: v })} />
      <ColorRow label="text" value={style?.textColor} onChange={(v) => set({ textColor: v })} />
      <Row2>
        <div>
          <label style={labelStyle}>border style</label>
          <select
            value={style?.borderStyle ?? ""}
            onChange={(e) =>
              set({ borderStyle: e.target.value === "" ? undefined : (e.target.value as NodeStyle["borderStyle"]) })
            }
            style={selectStyle}
          >
            <option value="">default</option>
            <option value="solid">solid</option>
            <option value="dashed">dashed</option>
            <option value="dotted">dotted</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>font weight</label>
          <select
            value={style?.fontWeight ?? ""}
            onChange={(e) =>
              set({ fontWeight: e.target.value === "" ? undefined : (e.target.value as NodeStyle["fontWeight"]) })
            }
            style={selectStyle}
          >
            <option value="">default</option>
            <option value="normal">normal</option>
            <option value="bold">bold</option>
          </select>
        </div>
      </Row2>
      <Row2>
        <div>
          <label style={labelStyle}>font size (px)</label>
          <DraftField
            value={style?.fontSize !== undefined ? String(style.fontSize) : ""}
            placeholder="13"
            onCommit={(raw) => {
              const t = raw.trim();
              if (t === "") return set({ fontSize: undefined });
              const n = Number(t);
              if (Number.isFinite(n) && n > 0) set({ fontSize: n });
            }}
          />
        </div>
        <div>
          {style !== undefined ? (
            <>
              <label style={labelStyle}>&nbsp;</label>
              <button style={smallBtn} onClick={() => onCommit(undefined)}>
                reset all styles
              </button>
            </>
          ) : null}
        </div>
      </Row2>
    </div>
  );
}
/** "true"/"42"/"[1,2]" become typed values; everything else stays a string. */
function parseAttrValue(raw: string): AttrValue {
  const t = raw.trim();
  if (t === "") return "";
  try {
    return JSON.parse(t) as AttrValue;
  } catch {
    return raw;
  }
}

function displayAttrValue(v: AttrValue): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** Key/value editor for the custom attrs bag shared by nodes, edges and groups. */
function AttrsEditor({
  attrs,
  onCommit,
}: {
  attrs: Attrs | undefined;
  onCommit: (next: Attrs | undefined) => void;
}) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const entries = Object.entries(attrs ?? {});

  const setKey = (key: string, value: AttrValue) => onCommit({ ...(attrs ?? {}), [key]: value });
  const removeKey = (key: string) => {
    const next = { ...(attrs ?? {}) };
    delete next[key];
    onCommit(Object.keys(next).length > 0 ? next : undefined);
  };
  const add = () => {
    const key = newKey.trim();
    if (key === "") return;
    setKey(key, parseAttrValue(newValue));
    setNewKey("");
    setNewValue("");
  };

  return (
    <div style={{ marginTop: 10, borderTop: "1px dashed var(--border)", paddingTop: 8 }}>
      <div style={{ color: "var(--muted)", marginBottom: 4 }}>custom attrs</div>
      {entries.map(([key, value]) => (
        <div key={key} style={{ display: "flex", gap: 4, marginBottom: 4, alignItems: "center" }}>
          <code style={{ flex: "0 0 32%", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis" }}>
            {key}
          </code>
          <div style={{ flex: 1 }}>
            <DraftField
              mono
              value={displayAttrValue(value)}
              onCommit={(raw) => setKey(key, parseAttrValue(raw))}
            />
          </div>
          <button style={smallBtn} title={`remove ${key}`} onClick={() => removeKey(key)}>
            ✕
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
        <input
          value={newKey}
          placeholder="key"
          onChange={(e) => setNewKey(e.target.value)}
          style={{ ...inputStyle, flex: "0 0 32%" }}
        />
        <input
          value={newValue}
          placeholder="value"
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button style={smallBtn} onClick={add} disabled={newKey.trim() === ""}>
          Add
        </button>
      </div>
    </div>
  );
}

/** Raw JSON escape hatch: edits the whole entity, applied as one update diff. */
function JsonEditor<T extends { id: string }>({
  entity,
  onApply,
}: {
  entity: T;
  onApply: (next: T) => string | null;
}) {
  const pretty = JSON.stringify(entity, null, 2);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(pretty);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setDraft(pretty);
    setErr(null);
  }, [pretty]);

  if (!open) {
    return (
      <button style={{ ...smallBtn, marginTop: 10 }} onClick={() => setOpen(true)}>
        Edit as JSON
      </button>
    );
  }
  return (
    <div style={{ marginTop: 10 }}>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        rows={Math.min(16, draft.split("\n").length + 1)}
        style={{
          ...inputStyle,
          fontFamily: "ui-monospace, monospace",
          fontSize: 11.5,
          resize: "vertical",
        }}
      />
      {err !== null ? <div style={{ color: "var(--danger)", marginTop: 4 }}>{err}</div> : null}
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <button
          style={smallBtn}
          onClick={() => {
            try {
              const parsed: unknown = JSON.parse(draft);
              if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
                throw new Error("expected an object");
              if ((parsed as { id?: unknown }).id !== entity.id)
                throw new Error(`id must stay "${entity.id}"`);
              const problem = onApply(parsed as T);
              if (problem !== null) throw new Error(problem);
              setErr(null);
              setOpen(false);
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Apply
        </button>
        <button
          style={smallBtn}
          onClick={() => {
            setDraft(pretty);
            setErr(null);
            setOpen(false);
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function formatTraceTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour12: false });
}

function RuntimeTrace({
  history,
  onSeek,
}: {
  history: readonly NodeRuntimeHistoryEntry[];
  onSeek: (ts: number) => void;
}) {
  if (history.length === 0) return null;

  const recent = history
    .map((entry, index) => ({
      entry,
      previousStatus: history[index - 1]?.runtime?.status,
    }))
    .slice(-12)
    .reverse();
  const metricHistory = new Map<string, { ts: number; value: string | number }[]>();
  for (const entry of history) {
    for (const [name, value] of Object.entries(entry.runtime?.metrics ?? {})) {
      const samples = metricHistory.get(name) ?? [];
      if (samples.at(-1)?.value !== value) samples.push({ ts: entry.ts, value });
      metricHistory.set(name, samples);
    }
  }

  return (
    <section style={{ marginTop: 10, borderTop: "1px dashed var(--border)", paddingTop: 8 }}>
      <h4 style={{ margin: "0 0 4px", fontSize: 12.5 }}>Runtime trace</h4>
      <div style={{ color: "var(--muted)", fontSize: 11.5, marginBottom: 6 }}>
        {history.length} retained event{history.length === 1 ? "" : "s"}
      </div>
      <ol style={{ margin: 0, paddingLeft: 18, fontSize: 11.5 }}>
        {recent.map(({ entry, previousStatus }) => {
          const currentStatus = entry.runtime?.status ?? "removed";
          const status =
            previousStatus !== undefined && previousStatus !== currentStatus
              ? `${previousStatus} -> ${currentStatus}`
              : currentStatus;
          const metrics = Object.entries(entry.runtime?.metrics ?? {});
          return (
            <li key={`${entry.key}-${entry.ts}`} style={{ marginBottom: 4 }}>
              <button
                type="button"
                style={{ ...smallBtn, width: "100%", textAlign: "left" }}
                onClick={() => onSeek(entry.ts)}
                aria-label={`Jump to runtime event at ${formatTraceTime(entry.ts)}`}
              >
                <span style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                  {formatTraceTime(entry.ts)}
                </span>{" "}
                <strong>{status}</strong>
                {metrics.length > 0 ? (
                  <span style={{ color: "var(--text-secondary)" }}>
                    {" "}
                    {metrics.map(([name, value]) => `${name} ${value}`).join(" · ")}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
      <div style={{ color: "var(--muted)", fontSize: 11.5, marginTop: 8, marginBottom: 3 }}>Metric history</div>
      {metricHistory.size === 0 ? (
        <div style={{ color: "var(--muted-2)", fontSize: 11.5 }}>No metric samples received.</div>
      ) : (
        <table style={{ fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>
          <tbody>
            {[...metricHistory.entries()].map(([name, samples]) => (
              <tr key={name}>
                <td style={{ color: "var(--muted)", paddingRight: 8, verticalAlign: "top" }}>{name}</td>
                <td>
                  {samples
                    .slice(-6)
                    .map((sample) => `${sample.value} @ ${formatTraceTime(sample.ts)}`)
                    .join(" -> ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export interface InspectorProps {
  doc: TopoDoc;
  node?: Node | undefined;
  edge?: Edge | undefined;
  group?: Group | undefined;
  nodeRuntime?: NodeRuntime | undefined;
  nodeTrace?: readonly NodeRuntimeHistoryEntry[] | undefined;
  multiCount: number;
  onDiff: (diff: GraphDiff) => void;
  onSeekTrace: (ts: number) => void;
  onUngroup: () => void;
  onToggleGroup: () => void;
}

export function Inspector({
  doc,
  node,
  edge,
  group,
  nodeRuntime,
  nodeTrace,
  multiCount,
  onDiff,
  onSeekTrace,
  onUngroup,
  onToggleGroup,
}: InspectorProps) {
  if (node) {
    const patchNode = (next: Node, summary: string) => {
      const op = makeNodeUpdate(node, next);
      if (op) onDiff({ origin: "user", summary, ops: [op] });
    };
    const setField = (field: keyof Node, raw: string) => {
      const next = { ...node } as Record<string, unknown>;
      if (raw.trim() === "") delete next[field];
      else next[field] = field === "tags" ? raw.split(",").map((t) => t.trim()).filter(Boolean) : raw;
      patchNode(next as unknown as Node, `edit ${node.id}.${field}`);
    };
    return (
      <div style={card} key={node.id}>
        <div style={{ fontWeight: 700 }}>{node.label}</div>
        <div style={{ color: "var(--muted)", marginBottom: 2 }}>
          {node.id}
          {node.ref !== undefined ? (
            <>
              {" · "}
              <code>{node.ref}</code>
            </>
          ) : null}
        </div>

        <Section title="Identity">
          <label style={labelStyle}>label</label>
          <DraftField value={node.label} onCommit={(v) => setField("label", v)} />
          <Row2>
            <div>
              <label style={labelStyle}>type</label>
              <DraftField value={node.type} onCommit={(v) => setField("type", v)} mono />
            </div>
            <div>
              <label style={labelStyle}>ref</label>
              <DraftField value={node.ref ?? ""} onCommit={(v) => setField("ref", v)} placeholder="resource id" mono />
            </div>
          </Row2>
          <label style={labelStyle}>icon (name or emoji; blank = type default)</label>
          <IconField value={node.icon ?? ""} onCommit={(v) => setField("icon", v)} />
        </Section>

        <Section title="Appearance">
          <StyleEditor
            style={node.style}
            onCommit={(style) => {
              const next = { ...node };
              if (style === undefined) delete next.style;
              else next.style = style;
              patchNode(next, `edit ${node.id}.style`);
            }}
          />
        </Section>

        <Section title="Metadata">
          <label style={labelStyle}>description</label>
          <DraftField value={node.description ?? ""} onCommit={(v) => setField("description", v)} placeholder="—" />
          <label style={labelStyle}>tags (comma separated)</label>
          <DraftField value={node.tags?.join(", ") ?? ""} onCommit={(v) => setField("tags", v)} placeholder="—" />
          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={node.locked === true}
              onChange={(event) => {
                const next = { ...node };
                if (event.target.checked) next.locked = true;
                else delete next.locked;
                patchNode(next, `${event.target.checked ? "lock" : "unlock"} ${node.id}`);
              }}
            />
            locked
          </label>
        </Section>

        <AttrsEditor
          attrs={node.attrs}
          onCommit={(attrs) => {
            const next = { ...node };
            if (attrs === undefined) delete next.attrs;
            else next.attrs = attrs;
            patchNode(next, `edit ${node.id}.attrs`);
          }}
        />

        <JsonEditor
          entity={node}
          onApply={(next) => {
            patchNode(next, `edit ${node.id} (json)`);
            return null;
          }}
        />

        {nodeRuntime ? (
          <div style={{ marginTop: 10, borderTop: "1px dashed var(--border)", paddingTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background:
                    nodeRuntime.status !== undefined ? statusPalette[nodeRuntime.status] : "var(--muted-2)",
                }}
              />
              <strong>{nodeRuntime.status ?? "unknown"}</strong>
              {nodeRuntime.message !== undefined ? (
                <span style={{ color: "var(--muted)" }}>{nodeRuntime.message}</span>
              ) : null}
            </div>
            {nodeRuntime.metrics !== undefined ? (
              <table style={{ marginTop: 6, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                <tbody>
                  {Object.entries(nodeRuntime.metrics).map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ color: "var(--muted)", paddingRight: 12 }}>{k}</td>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        ) : null}
        {nodeTrace !== undefined ? <RuntimeTrace history={nodeTrace} onSeek={onSeekTrace} /> : null}
      </div>
    );
  }

  if (edge) {
    const patchEdge = (next: Edge, summary: string) => {
      const op = makeEdgeUpdate(edge, next);
      if (op) onDiff({ origin: "user", summary, ops: [op] });
    };
    const setField = (field: keyof Edge, raw: string) => {
      const next = { ...edge } as Record<string, unknown>;
      if (raw.trim() === "") delete next[field];
      else if (field === "weight") {
        const n = Number(raw);
        if (Number.isNaN(n)) return;
        next[field] = n;
      } else next[field] = raw;
      patchEdge(next as unknown as Edge, `edit edge ${edge.id}.${field}`);
    };
    const srcLabel = doc.graph.nodes.find((n) => n.id === edge.source)?.label ?? edge.source;
    const dstLabel = doc.graph.nodes.find((n) => n.id === edge.target)?.label ?? edge.target;
    const arrowGlyph =
      edge.directed !== true ? "—" : edge.arrow === "backward" ? "←" : edge.arrow === "both" ? "↔" : "→";
    const directionValue: "none" | "forward" | "backward" | "both" =
      edge.directed !== true ? "none" : (edge.arrow ?? "forward");
    return (
      <div style={card} key={edge.id}>
        <div style={{ fontWeight: 700 }}>
          {srcLabel} {arrowGlyph} {dstLabel}
        </div>
        <div style={{ color: "var(--muted)", marginBottom: 6 }}>edge · {edge.id}</div>

        <label style={labelStyle}>label</label>
        <DraftField value={edge.label ?? ""} onCommit={(v) => setField("label", v)} placeholder="—" />
        <label style={labelStyle}>type</label>
        <DraftField value={edge.type ?? ""} onCommit={(v) => setField("type", v)} placeholder="—" mono />
        <label style={labelStyle}>color</label>
        <DraftField value={edge.color ?? ""} onCommit={(v) => setField("color", v)} placeholder="#hex" mono />
        <label style={labelStyle}>weight</label>
        <DraftField value={edge.weight?.toString() ?? ""} onCommit={(v) => setField("weight", v)} placeholder="number" mono />
        <label style={labelStyle}>direction</label>
        <select
          value={directionValue}
          onChange={(e) => {
            const value = e.target.value as "none" | "forward" | "backward" | "both";
            const next = { ...edge };
            if (value === "none") {
              delete next.directed;
              delete next.arrow;
            } else {
              next.directed = true;
              if (value === "forward") delete next.arrow;
              else next.arrow = value;
            }
            patchEdge(next, `edit edge ${edge.id}.direction`);
          }}
          style={selectStyle}
        >
          <option value="none">undirected —</option>
          <option value="forward">forward →</option>
          <option value="backward">backward ←</option>
          <option value="both">both ↔</option>
        </select>

        <AttrsEditor
          attrs={edge.attrs}
          onCommit={(attrs) => {
            const next = { ...edge };
            if (attrs === undefined) delete next.attrs;
            else next.attrs = attrs;
            patchEdge(next, `edit edge ${edge.id}.attrs`);
          }}
        />

        <JsonEditor
          entity={edge}
          onApply={(next) => {
            if (
              !doc.graph.nodes.some((n) => n.id === next.source) ||
              !doc.graph.nodes.some((n) => n.id === next.target)
            )
              return "source/target must reference existing nodes";
            patchEdge(next, `edit edge ${edge.id} (json)`);
            return null;
          }}
        />
      </div>
    );
  }

  if (group) {
    const patchGroup = (next: Group, summary: string) => {
      const op = makeGroupUpdate(group, next);
      if (op) onDiff({ origin: "user", summary, ops: [op] });
    };
    return (
      <div style={card} key={group.id}>
        <div style={{ fontWeight: 700 }}>{group.label}</div>
        <div style={{ color: "var(--muted)", marginBottom: 6 }}>
          group · {group.children.length} member(s)
          {group.collapsed === true ? " · collapsed" : ""}
        </div>
        <label style={labelStyle}>label</label>
        <DraftField value={group.label} onCommit={(v) => patchGroup({ ...group, label: v }, `rename group ${group.id}`)} />
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <button style={smallBtn} onClick={onToggleGroup}>
            {group.collapsed === true ? "Expand" : "Collapse"}
          </button>
          <button style={smallBtn} onClick={onUngroup}>
            Ungroup
          </button>
        </div>
        <div style={{ marginTop: 10, borderTop: "1px dashed var(--border)", paddingTop: 8 }}>
          <div style={{ color: "var(--muted)", marginBottom: 4 }}>members</div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {group.children.map((c) => {
              const memberNode = doc.graph.nodes.find((n) => n.id === c);
              const memberGroup = memberNode ? undefined : doc.graph.groups.find((g) => g.id === c);
              return (
                <li key={c} style={{ marginBottom: 2 }}>
                  {memberNode ? memberNode.label : memberGroup ? `${memberGroup.label} (group)` : c}
                </li>
              );
            })}
          </ul>
        </div>
        <AttrsEditor
          attrs={group.attrs}
          onCommit={(attrs) => {
            const next = { ...group };
            if (attrs === undefined) delete next.attrs;
            else next.attrs = attrs;
            patchGroup(next, `edit group ${group.id}.attrs`);
          }}
        />
        <JsonEditor
          entity={group}
          onApply={(next) => {
            patchGroup(next, `edit group ${group.id} (json)`);
            return null;
          }}
        />
      </div>
    );
  }

  return (
    <div style={{ color: "var(--muted-2)" }}>
      {multiCount > 1 ? `${multiCount} items selected` : "select a node, edge or group"}
    </div>
  );
}
