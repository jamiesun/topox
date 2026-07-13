import { useEffect, useState, type CSSProperties } from "react";
import type {
  AttrValue,
  Attrs,
  Edge,
  GraphDiff,
  Group,
  Node,
  NodeRuntime,
  TopoDoc,
} from "@topox/core";
import { makeEdgeUpdate, makeGroupUpdate, makeNodeUpdate } from "@topox/core";
import { statusPalette } from "@topox/editor";

const card: CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  padding: 10,
};

const inputStyle: CSSProperties = {
  width: "100%",
  border: "1px solid #d0d7de",
  borderRadius: 6,
  padding: "4px 8px",
  boxSizing: "border-box",
  fontSize: 12.5,
  fontFamily: "inherit",
};

const labelStyle: CSSProperties = { display: "block", marginTop: 8, color: "#64748b" };

const smallBtn: CSSProperties = {
  border: "1px solid #d0d7de",
  borderRadius: 6,
  background: "#fff",
  cursor: "pointer",
  fontSize: 11.5,
  padding: "3px 8px",
  color: "#334155",
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
    <div style={{ marginTop: 10, borderTop: "1px dashed #e2e8f0", paddingTop: 8 }}>
      <div style={{ color: "#64748b", marginBottom: 4 }}>custom attrs</div>
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
      {err !== null ? <div style={{ color: "#dc2626", marginTop: 4 }}>{err}</div> : null}
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

export interface InspectorProps {
  doc: TopoDoc;
  node?: Node | undefined;
  edge?: Edge | undefined;
  group?: Group | undefined;
  nodeRuntime?: NodeRuntime | undefined;
  multiCount: number;
  onDiff: (diff: GraphDiff) => void;
  onUngroup: () => void;
  onToggleGroup: () => void;
}

export function Inspector({
  doc,
  node,
  edge,
  group,
  nodeRuntime,
  multiCount,
  onDiff,
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
        <div style={{ color: "#64748b", marginBottom: 6 }}>
          {node.id}
          {node.ref !== undefined ? (
            <>
              {" · "}
              <code>{node.ref}</code>
            </>
          ) : null}
        </div>

        <label style={labelStyle}>label</label>
        <DraftField value={node.label} onCommit={(v) => setField("label", v)} />
        <label style={labelStyle}>type</label>
        <DraftField value={node.type} onCommit={(v) => setField("type", v)} mono />
        <label style={labelStyle}>description</label>
        <DraftField value={node.description ?? ""} onCommit={(v) => setField("description", v)} placeholder="—" />
        <label style={labelStyle}>tags (comma separated)</label>
        <DraftField value={node.tags?.join(", ") ?? ""} onCommit={(v) => setField("tags", v)} placeholder="—" />
        <label style={labelStyle}>ref</label>
        <DraftField value={node.ref ?? ""} onCommit={(v) => setField("ref", v)} placeholder="external resource id" mono />

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
          <div style={{ marginTop: 10, borderTop: "1px dashed #e2e8f0", paddingTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background:
                    nodeRuntime.status !== undefined ? statusPalette[nodeRuntime.status] : "#94a3b8",
                }}
              />
              <strong>{nodeRuntime.status ?? "unknown"}</strong>
              {nodeRuntime.message !== undefined ? (
                <span style={{ color: "#64748b" }}>{nodeRuntime.message}</span>
              ) : null}
            </div>
            {nodeRuntime.metrics !== undefined ? (
              <table style={{ marginTop: 6, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                <tbody>
                  {Object.entries(nodeRuntime.metrics).map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ color: "#64748b", paddingRight: 12 }}>{k}</td>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        ) : null}
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
    return (
      <div style={card} key={edge.id}>
        <div style={{ fontWeight: 700 }}>
          {srcLabel} {edge.directed === true ? "→" : "—"} {dstLabel}
        </div>
        <div style={{ color: "#64748b", marginBottom: 6 }}>edge · {edge.id}</div>

        <label style={labelStyle}>label</label>
        <DraftField value={edge.label ?? ""} onCommit={(v) => setField("label", v)} placeholder="—" />
        <label style={labelStyle}>type</label>
        <DraftField value={edge.type ?? ""} onCommit={(v) => setField("type", v)} placeholder="—" mono />
        <label style={labelStyle}>color</label>
        <DraftField value={edge.color ?? ""} onCommit={(v) => setField("color", v)} placeholder="#hex" mono />
        <label style={labelStyle}>weight</label>
        <DraftField value={edge.weight?.toString() ?? ""} onCommit={(v) => setField("weight", v)} placeholder="number" mono />
        <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={edge.directed === true}
            onChange={(e) =>
              patchEdge({ ...edge, directed: e.target.checked }, `edit edge ${edge.id}.directed`)
            }
          />
          directed
        </label>

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
        <div style={{ color: "#64748b", marginBottom: 6 }}>
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
        <div style={{ marginTop: 10, borderTop: "1px dashed #e2e8f0", paddingTop: 8 }}>
          <div style={{ color: "#64748b", marginBottom: 4 }}>members</div>
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
    <div style={{ color: "#8b95a1" }}>
      {multiCount > 1 ? `${multiCount} items selected` : "select a node, edge or group"}
    </div>
  );
}
