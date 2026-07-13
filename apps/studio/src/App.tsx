import { useCallback, useMemo, useRef, useState } from "react";
import type { GraphDiff, TopoDoc } from "@topox/core";
import {
  applyDiff,
  History,
  inventoryToCsv,
  searchNodes,
  toInventory,
  validateDoc,
} from "@topox/core";
import { compileDsl } from "@topox/dsl";
import { autoLayoutDiff, TopoCanvas } from "@topox/editor";
import { AiPanel } from "./AiPanel.js";
import { demoDoc } from "./demo.js";

type Tab = "canvas" | "inventory" | "json";
type SideTab = "inspect" | "ai";

const styles = {
  root: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100vh",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    color: "#1f2d3d",
  },
  topbar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 14px",
    borderBottom: "1px solid #e2e8f0",
    background: "#fff",
  },
  brand: { fontWeight: 700, fontSize: 15, marginRight: 12 },
  btn: {
    border: "1px solid #d0d7de",
    background: "#fff",
    borderRadius: 6,
    padding: "5px 10px",
    fontSize: 12.5,
    cursor: "pointer",
  },
  tab: (active: boolean) => ({
    ...styles.btn,
    ...(active ? { background: "#1f2d3d", color: "#fff", borderColor: "#1f2d3d" } : {}),
  }),
  main: { display: "flex", flex: 1, minHeight: 0 },
  side: {
    width: 300,
    borderLeft: "1px solid #e2e8f0",
    background: "#fafbfc",
    overflow: "auto" as const,
    padding: 12,
    fontSize: 12.5,
  },
} as const;

export function App() {
  const historyRef = useRef(new History(demoDoc()));
  const [doc, setDoc] = useState<TopoDoc>(historyRef.current.doc);
  const [tab, setTab] = useState<Tab>("canvas");
  const [sideTab, setSideTab] = useState<SideTab>("inspect");
  const [dsl, setDsl] = useState("");
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const history = historyRef.current;
  const viewId = doc.views[0]?.id ?? "default";

  const pushDiff = useCallback(
    (diff: GraphDiff) => {
      try {
        setDoc(history.apply(diff));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [history],
  );

  const undo = useCallback(() => setDoc(history.undo()), [history]);
  const redo = useCallback(() => setDoc(history.redo()), [history]);
  const autoLayout = useCallback(
    () => pushDiff(autoLayoutDiff(history.doc, viewId)),
    [history, pushDiff, viewId],
  );

  const importJson = useCallback((raw: string) => {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        !("graph" in parsed) ||
        !("views" in parsed)
      ) {
        throw new Error("expected a TopoDoc: { graph, views }");
      }
      const imported = parsed as TopoDoc;
      const problems = validateDoc(imported).filter((i) => i.severity === "error");
      if (problems.length > 0) {
        throw new Error(problems.map((p) => p.message).join("; "));
      }
      historyRef.current = new History(imported);
      setDoc(imported);
      setError(null);
    } catch (e) {
      setError(`import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const issues = useMemo(() => validateDoc(doc), [doc]);

  // AI/DSL pipeline: DSL text compiles live into a staged diff; the canvas
  // previews the result read-only until the user applies or discards.
  const compiled = useMemo(() => (dsl.trim() === "" ? null : compileDsl(dsl, doc)), [dsl, doc]);
  const previewDoc = useMemo(() => {
    if (!compiled || compiled.diff.ops.length === 0) return null;
    try {
      return applyDiff(doc, compiled.diff);
    } catch {
      return null;
    }
  }, [compiled, doc]);

  const applyStaged = useCallback(() => {
    if (!compiled || compiled.diff.ops.length === 0) return;
    pushDiff({ ...compiled.diff, origin: "ai/dsl" });
    setDsl("");
  }, [compiled, pushDiff]);

  const discardStaged = useCallback(() => setDsl(""), []);
  const inventory = useMemo(() => toInventory(doc.graph), [doc.graph]);
  const matches = useMemo(() => searchNodes(doc.graph, query), [doc.graph, query]);
  const matchedIds = useMemo(() => new Set(matches.map((n) => n.id)), [matches]);
  const selectedNode = useMemo(
    () => doc.graph.nodes.find((n) => selection.length === 1 && n.id === selection[0]),
    [doc.graph.nodes, selection],
  );

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${doc.graph.id}.topox.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [doc]);

  const exportCsv = useCallback(() => {
    const blob = new Blob([inventoryToCsv(inventory)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${doc.graph.id}.inventory.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [doc.graph.id, inventory]);

  return (
    <div style={styles.root}>
      <div style={styles.topbar}>
        <span style={styles.brand}>TopoX Studio</span>
        <button style={styles.tab(tab === "canvas")} onClick={() => setTab("canvas")}>Canvas</button>
        <button style={styles.tab(tab === "inventory")} onClick={() => setTab("inventory")}>Inventory</button>
        <button style={styles.tab(tab === "json")} onClick={() => setTab("json")}>JSON</button>
        <span style={{ width: 12 }} />
        <button style={styles.btn} onClick={undo} disabled={!history.canUndo}>Undo</button>
        <button style={styles.btn} onClick={redo} disabled={!history.canRedo}>Redo</button>
        <button style={styles.btn} onClick={autoLayout}>Auto layout</button>
        <button style={styles.btn} onClick={() => fileInputRef.current?.click()}>Import JSON</button>
        <button style={styles.btn} onClick={exportJson}>Export JSON</button>
        <button style={styles.btn} onClick={exportCsv}>Export CSV</button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            void file.text().then((raw) => importJson(raw));
            e.target.value = "";
          }}
        />
        <input
          placeholder="search nodes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            marginLeft: "auto",
            border: "1px solid #d0d7de",
            borderRadius: 6,
            padding: "5px 10px",
            fontSize: 12.5,
            width: 180,
          }}
        />
      </div>

      {error ? (
        <div style={{ background: "#fff5f5", color: "#c53030", padding: "6px 14px", fontSize: 12.5 }}>
          {error}
        </div>
      ) : null}

      <div style={styles.main}>
        <div style={{ flex: 1, minWidth: 0, position: "relative", display: "flex", flexDirection: "column" }}>
          {previewDoc && tab === "canvas" ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "6px 14px",
                background: "#fffbeb",
                borderBottom: "1px solid #fde68a",
                fontSize: 12.5,
              }}
            >
              <span style={{ fontWeight: 600, color: "#92400e" }}>
                Preview · {compiled?.diff.ops.length} op(s) staged — nothing applied yet
              </span>
              <button
                style={{ ...styles.btn, background: "#16a34a", color: "#fff", borderColor: "#16a34a" }}
                onClick={applyStaged}
              >
                Apply
              </button>
              <button style={styles.btn} onClick={discardStaged}>Discard</button>
            </div>
          ) : null}
          <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          {tab === "canvas" ? (
            <TopoCanvas
              doc={previewDoc ?? doc}
              viewId={viewId}
              onDiff={pushDiff}
              onSelect={(n) => setSelection(n)}
              readOnly={previewDoc !== null}
            />
          ) : tab === "inventory" ? (
            <div style={{ overflow: "auto", height: "100%", padding: 16 }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
                <thead>
                  <tr>
                    {["id", "type", "label", "ref", "tags", "group", "connections", "description"].map((h) => (
                      <th key={h} style={{ textAlign: "left", borderBottom: "2px solid #e2e8f0", padding: "6px 10px", position: "sticky", top: 0, background: "#fff" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inventory
                    .filter((r) => matchedIds.has(r.id))
                    .map((row) => (
                      <tr key={row.id}>
                        <td style={{ padding: "6px 10px", borderBottom: "1px solid #eef1f4", fontFamily: "monospace" }}>{row.id}</td>
                        <td style={{ padding: "6px 10px", borderBottom: "1px solid #eef1f4" }}>{row.type}</td>
                        <td style={{ padding: "6px 10px", borderBottom: "1px solid #eef1f4", fontWeight: 600 }}>{row.label}</td>
                        <td style={{ padding: "6px 10px", borderBottom: "1px solid #eef1f4", fontFamily: "monospace" }}>{row.ref}</td>
                        <td style={{ padding: "6px 10px", borderBottom: "1px solid #eef1f4" }}>{row.tags}</td>
                        <td style={{ padding: "6px 10px", borderBottom: "1px solid #eef1f4" }}>{row.group}</td>
                        <td style={{ padding: "6px 10px", borderBottom: "1px solid #eef1f4" }}>{row.connections}</td>
                        <td style={{ padding: "6px 10px", borderBottom: "1px solid #eef1f4", color: "#64748b" }}>{row.description}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <pre style={{ margin: 0, padding: 16, overflow: "auto", height: "100%", fontSize: 12, background: "#0d1117", color: "#c9d1d9" }}>
              {JSON.stringify(doc, null, 2)}
            </pre>
          )}
          </div>
        </div>

        <div style={styles.side}>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <button style={styles.tab(sideTab === "inspect")} onClick={() => setSideTab("inspect")}>Inspector</button>
            <button style={styles.tab(sideTab === "ai")} onClick={() => setSideTab("ai")}>AI</button>
          </div>
          {sideTab === "ai" ? (
            <AiPanel doc={doc} dsl={dsl} onDslChange={setDsl} compiled={compiled} />
          ) : (
          <>
          <section>
            <h3 style={{ margin: "2px 0 8px", fontSize: 13 }}>Inspector</h3>
            {selectedNode ? (
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 10 }}>
                <div style={{ fontWeight: 700 }}>{selectedNode.label}</div>
                <div style={{ color: "#64748b", marginBottom: 6 }}>{selectedNode.type}</div>
                {selectedNode.ref ? <div>ref: <code>{selectedNode.ref}</code></div> : null}
                {selectedNode.description ? <div style={{ marginTop: 4 }}>{selectedNode.description}</div> : null}
                {selectedNode.tags?.length ? <div style={{ marginTop: 4 }}>tags: {selectedNode.tags.join(", ")}</div> : null}
                <label style={{ display: "block", marginTop: 8, color: "#64748b" }}>label</label>
                <input
                  value={selectedNode.label}
                  onChange={(e) =>
                    pushDiff({
                      origin: "user",
                      summary: `rename ${selectedNode.id}`,
                      ops: [{ op: "update_node", id: selectedNode.id, before: { label: selectedNode.label }, after: { label: e.target.value } }],
                    })
                  }
                  style={{ width: "100%", border: "1px solid #d0d7de", borderRadius: 6, padding: "4px 8px", boxSizing: "border-box" }}
                />
              </div>
            ) : (
              <div style={{ color: "#8b95a1" }}>{selection.length > 1 ? `${selection.length} nodes selected` : "select a node"}</div>
            )}
          </section>

          <section style={{ marginTop: 16 }}>
            <h3 style={{ margin: "2px 0 8px", fontSize: 13 }}>
              History ({history.applied.length})
            </h3>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              {history.applied.slice(-12).map((d, i) => (
                <li key={i} style={{ marginBottom: 3, color: "#475569" }}>
                  <span style={{ color: "#94a3b8" }}>[{d.origin ?? "?"}]</span> {d.summary ?? `${d.ops.length} op(s)`}
                </li>
              ))}
            </ol>
          </section>

          <section style={{ marginTop: 16 }}>
            <h3 style={{ margin: "2px 0 8px", fontSize: 13 }}>Validation</h3>
            {issues.length === 0 ? (
              <div style={{ color: "#16a34a" }}>✓ no issues</div>
            ) : (
              issues.map((issue, i) => (
                <div key={i} style={{ color: issue.severity === "error" ? "#dc2626" : "#d97706", marginBottom: 3 }}>
                  [{issue.severity}] {issue.message}
                </div>
              ))
            )}
          </section>

          <section style={{ marginTop: 16, color: "#8b95a1" }}>
            {doc.graph.nodes.length} nodes · {doc.graph.edges.length} edges · {doc.graph.groups.length} groups
            {query ? ` · ${matches.length} match(es)` : ""}
          </section>
          </>
          )}
        </div>
      </div>
    </div>
  );
}
