import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphDiff, RuntimeState, TopoDoc } from "@topox/core";
import {
  applyDiff,
  applyRuntimeEvent,
  emptyRuntime,
  History,
  inventoryToCsv,
  makeGroupOps,
  makeGroupUpdate,
  makeUngroupOps,
  resolveRuntime,
  RuntimeTimeline,
  searchNodes,
  toInventory,
  validateDoc,
} from "@topox/core";
import { compileDsl } from "@topox/dsl";
import { autoLayoutDiff, statusPalette, TopoCanvas } from "@topox/editor";
import { docFromYaml, docToYaml, parseMermaid, toMermaid } from "@topox/interop";
import { AiPanel } from "./AiPanel.js";
import { demoDoc } from "./demo.js";
import { fetchDoc, parseDocSource, saveDocTo } from "./docsource.js";
import { Dropdown } from "./Dropdown.js";
import { Inspector } from "./Inspector.js";
import { simulateTick } from "./simulate.js";
import { TimelineBar } from "./TimelineBar.js";

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
  const [edgeSelection, setEdgeSelection] = useState<string[]>([]);
  const [groupSelection, setGroupSelection] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<RuntimeState>(emptyRuntime());
  const [simulating, setSimulating] = useState(false);
  const [replayTs, setReplayTs] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const docSource = useMemo(() => parseDocSource(window.location.search), []);
  const savedDocRef = useRef<TopoDoc | null>(null);
  const timelineRef = useRef(new RuntimeTimeline({ checkpointInterval: 25 }));
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
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

  // Shared-studio mode: load the document named by ?src=, save via PUT.
  useEffect(() => {
    if (!docSource) return;
    let cancelled = false;
    fetchDoc(docSource.src)
      .then((loaded) => {
        if (cancelled) return;
        historyRef.current = new History(loaded);
        savedDocRef.current = loaded;
        setDoc(loaded);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [docSource]);

  const dirty = docSource !== null && savedDocRef.current !== doc;

  const saveRemote = useCallback(() => {
    if (!docSource) return;
    const current = historyRef.current.doc;
    setSaveState("saving");
    saveDocTo(docSource.save, current)
      .then(() => {
        savedDocRef.current = current;
        setSaveState("saved");
        setError(null);
      })
      .catch((e: unknown) => {
        setSaveState("failed");
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [docSource]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const importFile = useCallback((name: string, raw: string) => {    try {
      const ext = name.toLowerCase().split(".").pop() ?? "";
      let imported: TopoDoc;
      let notice: string | null = null;
      if (ext === "mmd" || ext === "mermaid") {
        const { doc: parsed, warnings } = parseMermaid(raw);
        // Mermaid carries no geometry; give the fresh doc a usable layout.
        imported = applyDiff(parsed, autoLayoutDiff(parsed, parsed.views[0]?.id ?? "default"));
        if (warnings.length > 0) notice = `imported with warnings: ${warnings.join("; ")}`;
      } else if (ext === "yaml" || ext === "yml") {
        imported = docFromYaml(raw);
      } else {
        const parsed: unknown = JSON.parse(raw);
        if (
          parsed === null ||
          typeof parsed !== "object" ||
          !("graph" in parsed) ||
          !("views" in parsed)
        ) {
          throw new Error("expected a TopoDoc: { graph, views }");
        }
        imported = parsed as TopoDoc;
      }
      const problems = validateDoc(imported).filter((i) => i.severity === "error");
      if (problems.length > 0) {
        throw new Error(problems.map((p) => p.message).join("; "));
      }
      historyRef.current = new History(imported);
      setDoc(imported);
      setError(notice);
    } catch (e) {
      setError(`import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const handleSelect = useCallback((nodeIds: string[], edgeIds: string[], groupIds: string[] = []) => {
    const same = (prev: string[], next: string[]) =>
      prev.length === next.length && prev.every((v, i) => v === next[i]);
    setSelection((prev) => (same(prev, nodeIds) ? prev : nodeIds));
    setEdgeSelection((prev) => (same(prev, edgeIds) ? prev : edgeIds));
    setGroupSelection((prev) => (same(prev, groupIds) ? prev : groupIds));
  }, []);

  const issues = useMemo(() => validateDoc(doc), [doc]);

  // Live overlay: simulator ticks feed the same event pipeline a real
  // WebSocket/SSE collector would. Runtime state never enters doc/history;
  // every event is also recorded into the timeline for replay.
  useEffect(() => {
    if (!simulating) return;
    const timer = setInterval(() => {
      const ts = Date.now();
      const events = simulateTick(historyRef.current.doc, runtimeRef.current).map((e) => ({ ...e, ts }));
      for (const e of events) timelineRef.current.record(e);
      setRuntime((prev) => events.reduce(applyRuntimeEvent, prev));
    }, 1200);
    return () => clearInterval(timer);
  }, [simulating]);

  const toggleSimulate = useCallback(() => {
    setSimulating((on) => {
      if (on) {
        setRuntime(emptyRuntime());
        timelineRef.current.clear();
        setReplayTs(null);
        setPlaying(false);
      }
      return !on;
    });
  }, []);

  // DVR playback: advance the replay cursor at 1x, chasing the live edge.
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setReplayTs((prev) => {
        const end = timelineRef.current.range?.end;
        return prev === null || end === undefined ? prev : Math.min(prev + 500, end);
      });
    }, 500);
    return () => clearInterval(timer);
  }, [playing]);

  const timelineRange = timelineRef.current.range;
  const handleSeek = useCallback((ts: number) => {
    setPlaying(false);
    setReplayTs(ts);
  }, []);
  const handleTogglePlay = useCallback(() => {
    if (replayTs === null) {
      const start = timelineRef.current.range?.start;
      if (start === undefined) return;
      setReplayTs(start); // Play from live = replay from the beginning
      setPlaying(true);
    } else {
      setPlaying((p) => !p);
    }
  }, [replayTs]);
  const handleLive = useCallback(() => {
    setPlaying(false);
    setReplayTs(null);
  }, []);

  const replayState = useMemo(
    () => (replayTs !== null ? timelineRef.current.stateAt(replayTs) : null),
    [replayTs],
  );
  const activeRuntime = replayState ?? runtime;
  const resolvedRuntime = useMemo(
    () => (activeRuntime.ts !== undefined ? resolveRuntime(doc, activeRuntime) : undefined),
    [doc, activeRuntime],
  );
  const selectedRuntime = useMemo(
    () => (selection.length === 1 && selection[0] !== undefined ? resolvedRuntime?.nodes.get(selection[0]) : undefined),
    [resolvedRuntime, selection],
  );

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
  const selectedGroup = useMemo(
    () => doc.graph.groups.find((g) => groupSelection.length === 1 && g.id === groupSelection[0]),
    [doc.graph.groups, groupSelection],
  );
  const selectedEdge = useMemo(
    () => doc.graph.edges.find((e) => edgeSelection.length === 1 && e.id === edgeSelection[0]),
    [doc.graph.edges, edgeSelection],
  );

  const groupSelected = useCallback(() => {
    if (selection.length < 2) return;
    const id = `grp-${Date.now().toString(36)}`;
    pushDiff({
      origin: "user",
      summary: `group ${selection.length} nodes`,
      ops: makeGroupOps(history.doc.graph, {
        id,
        label: `Group (${selection.length})`,
        children: [...selection],
      }),
    });
  }, [history, pushDiff, selection]);

  const ungroupSelected = useCallback(() => {
    if (!selectedGroup) return;
    pushDiff({
      origin: "user",
      summary: `ungroup ${selectedGroup.label}`,
      ops: makeUngroupOps(history.doc.graph, selectedGroup.id),
    });
  }, [history, pushDiff, selectedGroup]);

  const toggleSelectedGroup = useCallback(() => {
    if (!selectedGroup) return;
    const op = makeGroupUpdate(selectedGroup, {
      ...selectedGroup,
      collapsed: !(selectedGroup.collapsed ?? false),
    });
    if (!op) return;
    pushDiff({
      origin: "user",
      summary: `${selectedGroup.collapsed === true ? "expand" : "collapse"} group ${selectedGroup.label}`,
      ops: [op],
    });
  }, [pushDiff, selectedGroup]);

  const download = useCallback((filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }, []);

  const exportJson = useCallback(
    () => download(`${doc.graph.id}.topox.json`, JSON.stringify(doc, null, 2), "application/json"),
    [doc, download],
  );
  const exportYaml = useCallback(
    () => download(`${doc.graph.id}.topox.yaml`, docToYaml(doc), "text/yaml"),
    [doc, download],
  );
  const exportMermaid = useCallback(
    () => download(`${doc.graph.id}.mmd`, toMermaid(doc), "text/plain"),
    [doc, download],
  );
  const exportCsv = useCallback(
    () => download(`${doc.graph.id}.inventory.csv`, inventoryToCsv(inventory), "text/csv"),
    [doc.graph.id, download, inventory],
  );

  return (
    <div style={styles.root}>
      <div style={styles.topbar}>
        <span style={styles.brand}>TopoX Studio</span>
        <button style={styles.tab(tab === "canvas")} onClick={() => setTab("canvas")}>Canvas</button>
        <button style={styles.tab(tab === "inventory")} onClick={() => setTab("inventory")}>Inventory</button>
        <button style={styles.tab(tab === "json")} onClick={() => setTab("json")}>JSON</button>
        <span style={{ width: 12 }} />
        <button style={styles.btn} onClick={undo} disabled={!history.canUndo} title="Undo">↩</button>
        <button style={styles.btn} onClick={redo} disabled={!history.canRedo} title="Redo">↪</button>
        <Dropdown
          label="File"
          buttonStyle={styles.btn}
          items={[
            { label: "Import…", hint: "json / yaml / mmd", onSelect: () => fileInputRef.current?.click() },
            { label: "Export JSON", hint: ".topox.json", onSelect: exportJson },
            { label: "Export YAML", hint: ".topox.yaml", onSelect: exportYaml },
            { label: "Export Mermaid", hint: ".mmd", onSelect: exportMermaid },
            { label: "Export CSV inventory", hint: ".csv", onSelect: exportCsv },
          ]}
        />
        <Dropdown
          label="Arrange"
          buttonStyle={styles.btn}
          items={[
            { label: "Auto layout", hint: "dagre TB", onSelect: autoLayout },
            {
              label: "Group selection",
              hint: "2+ nodes",
              disabled: selection.length < 2,
              onSelect: groupSelected,
            },
            {
              label: "Ungroup",
              hint: "dissolve",
              disabled: !selectedGroup,
              onSelect: ungroupSelected,
            },
          ]}
        />
        <span style={{ marginLeft: "auto" }} />
        {docSource ? (
          <>
            <button
              style={{ ...styles.btn, ...(dirty ? { borderColor: "#2563eb", color: "#2563eb" } : {}) }}
              onClick={saveRemote}
              disabled={!dirty || saveState === "saving"}
              title={`PUT ${docSource.save}`}
            >
              {saveState === "saving" ? "Saving…" : dirty ? "Save*" : saveState === "failed" ? "Retry save" : "Saved"}
            </button>
            {docSource.ret ? (
              <button
                style={styles.btn}
                onClick={() => {
                  if (!dirty || window.confirm("Discard unsaved changes?")) {
                    window.location.href = docSource.ret!;
                  }
                }}
              >
                ← Back
              </button>
            ) : null}
          </>
        ) : null}
        <button style={styles.tab(simulating)} onClick={toggleSimulate}>
          {simulating ? "◉ Live" : "Simulate"}
        </button>
        {simulating ? (
          <span style={{ display: "inline-flex", gap: 8, fontSize: 11, color: "#64748b" }}>
            {(Object.entries(statusPalette) as [string, string][]).map(([s, c]) => (
              <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: c }} />
                {s}
              </span>
            ))}
          </span>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.yaml,.yml,.mmd,.mermaid"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            void file.text().then((raw) => importFile(file.name, raw));
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
            <>
            <TopoCanvas
              doc={previewDoc ?? doc}
              viewId={viewId}
              onDiff={pushDiff}
              onSelect={handleSelect}
              readOnly={previewDoc !== null}
              {...(resolvedRuntime !== undefined ? { runtime: resolvedRuntime } : {})}
            />
            {timelineRange !== null ? (
              <TimelineBar
                range={timelineRange}
                replayTs={replayTs}
                playing={playing}
                onSeek={handleSeek}
                onTogglePlay={handleTogglePlay}
                onLive={handleLive}
              />
            ) : null}
            </>
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
            <Inspector
              doc={doc}
              node={selectedNode}
              edge={selectedEdge}
              group={selectedGroup}
              nodeRuntime={selectedRuntime}
              multiCount={selection.length + edgeSelection.length + groupSelection.length}
              onDiff={pushDiff}
              onUngroup={ungroupSelected}
              onToggleGroup={toggleSelectedGroup}
            />
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
