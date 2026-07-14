import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiffOp, GraphDiff, GraphProposal, Node, NodeLayout, RuntimeState, TopoDoc } from "@talkincode/topox-core";
import {
  applyDiff,
  applyRuntimeEvent,
  emptyDoc,
  emptyRuntime,
  History,
  hashDocGraph,
  parseGraphProposal,
  inventoryToCsv,
  makeDuplicateNodes,
  makeGroupOps,
  makeGroupUpdate,
  makeNodeUpdate,
  makeRemoveOps,
  makeUngroupOps,
  parseRuntimeSnapshot,
  previewGraphProposal,
  resolveRuntime,
  RuntimeTimeline,
  searchNodes,
  serializeRuntimeSnapshot,
  toInventory,
  validateDoc,
} from "@talkincode/topox-core";
import { compileDsl } from "@talkincode/topox-dsl";
import { autoLayoutDiff, statusPalette, toFlow, TopoCanvas, type DiffVisualProjection, type DiffVisualState, type LayoutDirection } from "@talkincode/topox-editor";
import {
  docFromYaml,
  docToYaml,
  parseDot,
  parseGraphML,
  parseMermaid,
  toDot,
  toGraphML,
  toMermaid,
} from "@talkincode/topox-interop";
import { AiPanel } from "./AiPanel.js";
import { demoDoc } from "./demo.js";
import { fetchDoc, fetchProposal, parseDocSource, parseProposalSource, saveDocTo } from "./docsource.js";
import { Dropdown } from "./Dropdown.js";
import { IconPickerDialog, typeLabel } from "./IconPicker.js";
import { useTheme } from "./theme.js";
import { Inspector } from "./Inspector.js";
import {
  createProject,
  deleteProject,
  getCurrentProjectId,
  listProjects,
  loadProjectDoc,
  renameProject,
  saveProjectDoc,
  setCurrentProjectId,
  type ProjectMeta,
} from "./projects.js";
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
    color: "var(--text)",
  },
  topbar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 14px",
    borderBottom: "1px solid var(--border)",
    background: "var(--surface)",
  },
  brand: { fontWeight: 700, fontSize: 15, marginRight: 12 },
  btn: {
    border: "1px solid var(--border)",
    background: "var(--surface)",
    borderRadius: 6,
    padding: "5px 10px",
    fontSize: 12.5,
    cursor: "pointer",
  },
  tab: (active: boolean) => ({
    ...styles.btn,
    ...(active ? { background: "var(--inverse-bg)", color: "var(--inverse-text)", borderColor: "var(--inverse-bg)" } : {}),
  }),
  main: { display: "flex", flex: 1, minHeight: 0 },
  side: {
    width: 300,
    borderLeft: "1px solid var(--border)",
    background: "var(--surface-2)",
    overflow: "auto" as const,
    padding: 12,
    fontSize: 12.5,
  },
} as const;

let idSeq = 0;
function freshId(prefix: string, existing: Set<string>): string {
  let id = `${prefix}-${Date.now().toString(36)}-${(idSeq += 1).toString(36)}`;
  while (existing.has(id)) id = `${prefix}-${Date.now().toString(36)}-${(idSeq += 1).toString(36)}`;
  return id;
}

const invCell = {
  padding: "3px 6px",
  borderBottom: "1px solid var(--border-soft)",
} as const;

const panelBox = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--surface)",
  padding: 10,
} as const;

/**
 * Borderless in-place cell editor for the inventory table. Commits on blur or
 * Enter — one invertible diff per edit, same as the Inspector fields.
 */
function InventoryCell({
  value,
  onCommit,
  mono = false,
  bold = false,
  disabled = false,
}: {
  value: string;
  onCommit: (next: string) => void;
  mono?: boolean;
  bold?: boolean;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        e.target.style.borderColor = "transparent";
        e.target.style.background = "transparent";
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value);
      }}
      style={{
        width: "100%",
        boxSizing: "border-box",
        border: "1px solid transparent",
        borderRadius: 4,
        padding: "3px 4px",
        fontSize: 12.5,
        background: "transparent",
        color: "inherit",
        fontFamily: mono ? "ui-monospace, monospace" : "inherit",
        fontWeight: bold ? 600 : 400,
      }}
      onFocus={(e) => {
        e.target.style.borderColor = "var(--accent)";
        e.target.style.background = "var(--surface)";
      }}
    />
  );
}

function hasCompleteLayout(doc: TopoDoc): boolean {
  const layout = doc.views[0]?.layout ?? {};
  return doc.graph.nodes.every((node) => {
    const position = layout[node.id];
    return position !== undefined && Number.isFinite(position.x) && Number.isFinite(position.y);
  });
}

function withAutoLayout(doc: TopoDoc): TopoDoc {
  return applyDiff(doc, autoLayoutDiff(doc, doc.views[0]?.id ?? "default"));
}

function rankDiffState(current: DiffVisualState | undefined, next: DiffVisualState): DiffVisualState {
  const rank: Record<DiffVisualState, number> = { removed: 4, added: 3, updated: 2, layout: 1 };
  return current === undefined || rank[next] > rank[current] ? next : current;
}

function diffVisualFrom(diff: GraphDiff | null): DiffVisualProjection | undefined {
  if (diff === null || diff.ops.length === 0) return undefined;
  const nodeStates = new Map<string, DiffVisualState>();
  const edgeStates = new Map<string, DiffVisualState>();
  for (const op of diff.ops) {
    switch (op.op) {
      case "add_node":
        nodeStates.set(op.node.id, rankDiffState(nodeStates.get(op.node.id), "added"));
        break;
      case "remove_node":
        nodeStates.set(op.node.id, rankDiffState(nodeStates.get(op.node.id), "removed"));
        break;
      case "update_node":
        nodeStates.set(op.id, rankDiffState(nodeStates.get(op.id), "updated"));
        break;
      case "add_edge":
        edgeStates.set(op.edge.id, rankDiffState(edgeStates.get(op.edge.id), "added"));
        break;
      case "remove_edge":
        edgeStates.set(op.edge.id, rankDiffState(edgeStates.get(op.edge.id), "removed"));
        break;
      case "update_edge":
        edgeStates.set(op.id, rankDiffState(edgeStates.get(op.id), "updated"));
        break;
      case "set_layout":
        nodeStates.set(op.nodeId, rankDiffState(nodeStates.get(op.nodeId), "layout"));
        break;
      case "add_group":
        nodeStates.set(op.group.id, rankDiffState(nodeStates.get(op.group.id), "added"));
        break;
      case "remove_group":
        nodeStates.set(op.group.id, rankDiffState(nodeStates.get(op.group.id), "removed"));
        break;
      case "update_group":
        nodeStates.set(op.id, rankDiffState(nodeStates.get(op.id), "updated"));
        break;
      case "add_view":
      case "remove_view":
      case "update_meta":
        break;
    }
  }
  return { nodeStates, edgeStates };
}

function visualDocWithRemovedEntities(base: TopoDoc, preview: TopoDoc, diff: GraphDiff | null): TopoDoc {
  if (diff === null) return preview;
  const next: TopoDoc = structuredClone(preview);
  const nodes = new Map(next.graph.nodes.map((node) => [node.id, node]));
  const edges = new Map(next.graph.edges.map((edge) => [edge.id, edge]));
  const groups = new Map(next.graph.groups.map((group) => [group.id, group]));
  const baseViewById = new Map(base.views.map((view) => [view.id, view]));
  for (const op of diff.ops) {
    if (op.op === "remove_node" && !nodes.has(op.node.id)) {
      next.graph.nodes.push(op.node);
      nodes.set(op.node.id, op.node);
    } else if (op.op === "remove_edge" && !edges.has(op.edge.id)) {
      next.graph.edges.push(op.edge);
      edges.set(op.edge.id, op.edge);
    } else if (op.op === "remove_group" && !groups.has(op.group.id)) {
      next.graph.groups.push(op.group);
      groups.set(op.group.id, op.group);
    } else if (op.op === "set_layout" && op.after === null && op.before !== null) {
      const view = next.views.find((candidate) => candidate.id === op.viewId);
      if (view !== undefined && view.layout[op.nodeId] === undefined) {
        view.layout[op.nodeId] = op.before;
      }
    }
  }
  for (const view of next.views) {
    const baseView = baseViewById.get(view.id);
    if (baseView === undefined) continue;
    for (const op of diff.ops) {
      if (op.op === "remove_node" && baseView.layout[op.node.id] !== undefined) {
        view.layout[op.node.id] = baseView.layout[op.node.id]!;
      }
    }
  }
  return next;
}

export function App() {
  const historyRef = useRef(new History(demoDoc()));
  const theme = useTheme();
  const [doc, setDoc] = useState<TopoDoc>(historyRef.current.doc);
  const [tab, setTab] = useState<Tab>("canvas");
  const [sideTab, setSideTab] = useState<SideTab>("inspect");
  const [dsl, setDsl] = useState("");
  const [query, setQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [selection, setSelection] = useState<string[]>([]);
  const [edgeSelection, setEdgeSelection] = useState<string[]>([]);
  const [groupSelection, setGroupSelection] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [insertOpen, setInsertOpen] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeState>(emptyRuntime());
  const [simulating, setSimulating] = useState(false);
  const [replayTs, setReplayTs] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [timelineRevision, setTimelineRevision] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [localSaveTick, setLocalSaveTick] = useState<"dirty" | "saved" | null>(null);
  const docSource = useMemo(() => parseDocSource(window.location.search), []);
  const [savedDoc, setSavedDoc] = useState<TopoDoc | null>(null);
  const [project, setProject] = useState<ProjectMeta | null>(null);
  const proposalSource = useMemo(() => parseProposalSource(window.location.search), []);
  const [proposal, setProposal] = useState<GraphProposal | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const timelineRef = useRef(new RuntimeTimeline({ checkpointInterval: 25 }));
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const simulationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const snapshotInputRef = useRef<HTMLInputElement>(null);
  const proposalInputRef = useRef<HTMLInputElement>(null);

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
    (direction: LayoutDirection = "TB") =>
      pushDiff(autoLayoutDiff(history.doc, viewId, { direction })),
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
        setSavedDoc(loaded);
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

  useEffect(() => {
    if (!proposalSource) return;
    let cancelled = false;
    fetchProposal(proposalSource)
      .then((loaded) => {
        if (cancelled) return;
        setProposal(loaded);
        setProposalError(null);
        setSideTab("ai");
        setTab("canvas");
      })
      .catch((e: unknown) => {
        if (!cancelled) setProposalError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [proposalSource]);

  // Local projects: restore the last-open project on startup (shared mode wins).
  useEffect(() => {
    if (docSource) return;
    const id = getCurrentProjectId();
    if (id === null) return;
    const meta = listProjects().find((p) => p.id === id);
    const stored = meta ? loadProjectDoc(id) : null;
    if (!meta || !stored) return;
    historyRef.current = new History(stored);
    setDoc(stored);
    setProject(meta);
  }, [docSource]);

  // Every accepted change is auto-persisted to the active project (debounced).
  useEffect(() => {
    if (!project || docSource) return;
    setLocalSaveTick("dirty");
    const timer = setTimeout(() => {
      saveProjectDoc(project.id, doc);
      setLocalSaveTick("saved");
    }, 300);
    return () => clearTimeout(timer);
  }, [doc, docSource, project]);

  const openProject = useCallback((meta: ProjectMeta) => {
    const stored = loadProjectDoc(meta.id);
    if (!stored) {
      setError(`project "${meta.name}" could not be loaded`);
      return;
    }
    historyRef.current = new History(stored);
    setDoc(stored);
    setProject(meta);
    setCurrentProjectId(meta.id);
    setError(null);
  }, []);

  const newProject = useCallback(() => {
    const name = window.prompt("New project name:", "Untitled topology")?.trim();
    if (!name) return;
    const fresh = emptyDoc(`topo-${Date.now().toString(36)}`, name);
    const meta = createProject(name, fresh);
    historyRef.current = new History(fresh);
    setDoc(fresh);
    setProject(meta);
    setCurrentProjectId(meta.id);
    setError(null);
  }, []);

  const saveAsProject = useCallback(() => {
    const current = historyRef.current.doc;
    const name = window
      .prompt("Save current diagram as project:", current.graph.meta?.name ?? "Untitled topology")
      ?.trim();
    if (!name) return;
    const meta = createProject(name, current);
    setProject(meta);
    setCurrentProjectId(meta.id);
    setError(null);
  }, []);

  const renameCurrentProject = useCallback(() => {
    if (!project) return;
    const name = window.prompt("Rename project:", project.name)?.trim();
    if (!name || name === project.name) return;
    renameProject(project.id, name);
    setProject({ ...project, name });
  }, [project]);

  const deleteCurrentProject = useCallback(() => {
    if (!project) return;
    if (!window.confirm(`Delete project "${project.name}"? This cannot be undone.`)) return;
    deleteProject(project.id);
    setProject(null);
    setCurrentProjectId(null);
    const fresh = demoDoc();
    historyRef.current = new History(fresh);
    setDoc(fresh);
  }, [project]);

  // Deep compare: undo back to the saved state must read as clean again.
  const dirty = useMemo(
    () =>
      docSource !== null &&
      savedDoc !== null &&
      savedDoc !== doc &&
      JSON.stringify(savedDoc) !== JSON.stringify(doc),
    [doc, docSource, savedDoc],
  );

  const saveRemote = useCallback(() => {
    if (!docSource) return;
    const current = historyRef.current.doc;
    setSaveState("saving");
    saveDocTo(docSource.save, current)
      .then(() => {
        setSavedDoc(current);
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

  const importFile = useCallback((name: string, raw: string) => {
    try {
      const ext = name.toLowerCase().split(".").pop() ?? "";
      let imported: TopoDoc;
      let notice: string | null = null;
      if (ext === "mmd" || ext === "mermaid") {
        const { doc: parsed, warnings } = parseMermaid(raw);
        // Mermaid carries no geometry; give the fresh doc a usable layout.
        imported = withAutoLayout(parsed);
        if (warnings.length > 0) notice = `imported with warnings: ${warnings.join("; ")}`;
      } else if (ext === "dot" || ext === "gv") {
        const { doc: parsed, warnings } = parseDot(raw);
        // DOT geometry is not part of the supported import subset.
        imported = withAutoLayout(parsed);
        if (warnings.length > 0) notice = `imported with warnings: ${warnings.join("; ")}`;
      } else if (ext === "graphml") {
        const { doc: parsed, warnings } = parseGraphML(raw);
        imported = hasCompleteLayout(parsed) ? parsed : withAutoLayout(parsed);
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

  const openProposalFile = useCallback((raw: string) => {
    try {
      const loaded = parseGraphProposal(JSON.parse(raw));
      setProposal(loaded);
      setProposalError(null);
      setSideTab("ai");
      setTab("canvas");
    } catch (e) {
      setProposal(null);
      setProposalError(`proposal import failed: ${e instanceof Error ? e.message : String(e)}`);
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
    simulationTimerRef.current = timer;
    return () => {
      clearInterval(timer);
      if (simulationTimerRef.current === timer) simulationTimerRef.current = null;
    };
  }, [simulating]);

  const toggleSimulate = useCallback(() => {
    if (simulationTimerRef.current !== null) {
      clearInterval(simulationTimerRef.current);
      simulationTimerRef.current = null;
    }
    setRuntime(emptyRuntime());
    timelineRef.current.clear();
    setTimelineRevision((revision) => revision + 1);
    setReplayTs(null);
    setPlaying(false);
    setSimulating((on) => !on);
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
  const timelineFrames = timelineRef.current.eventTimestamps;
  const handleSeek = useCallback((ts: number) => {
    setPlaying(false);
    setReplayTs(ts);
  }, []);
  const handleStep = useCallback((direction: -1 | 1) => {
    setPlaying(false);
    setReplayTs((current) => {
      const frames = timelineRef.current.eventTimestamps;
      if (frames.length === 0) return current;
      const cursor = current ?? frames[frames.length - 1]!;
      if (direction < 0) {
        for (let index = frames.length - 1; index >= 0; index--) {
          if (frames[index]! < cursor) return frames[index]!;
        }
        return frames[0]!;
      }
      for (const frame of frames) {
        if (frame > cursor) return frame;
      }
      return frames[frames.length - 1]!;
    });
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
    [replayTs, timelineRevision],
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

  // AI/DSL and MCP proposal pipeline: text/proposal diffs compile into a staged
  // read-only visual preview until the user applies or discards.
  const compiled = useMemo(() => (dsl.trim() === "" ? null : compileDsl(dsl, doc)), [dsl, doc]);
  const dslPreviewDoc = useMemo(() => {
    if (!compiled || compiled.diff.ops.length === 0) return null;
    try {
      return applyDiff(doc, compiled.diff);
    } catch {
      return null;
    }
  }, [compiled, doc]);
  const proposalPreview = useMemo(
    () => (proposal !== null ? previewGraphProposal(doc, proposal, { verifyBase: docSource !== null }) : null),
    [doc, docSource, proposal],
  );
  const activePreviewDiff = proposal?.diff ?? compiled?.diff ?? null;
  const semanticPreviewDoc =
    proposal !== null
      ? proposalPreview?.state === "ready"
        ? proposalPreview.doc ?? null
        : null
      : dslPreviewDoc;
  const previewDoc = useMemo(
    () => (semanticPreviewDoc !== null ? visualDocWithRemovedEntities(doc, semanticPreviewDoc, activePreviewDiff) : null),
    [activePreviewDiff, doc, semanticPreviewDoc],
  );
  const previewDiffVisual = useMemo(() => diffVisualFrom(activePreviewDiff), [activePreviewDiff]);
  const proposalBaseState = proposal !== null ? proposalPreview?.state ?? "invalid" : null;
  const currentGraphHash = useMemo(() => hashDocGraph(doc), [doc]);
  const stagedOpCount = proposal?.diff.ops.length ?? compiled?.diff.ops.length ?? 0;
  const canApplyPreview =
    proposal !== null ? proposalPreview?.state === "ready" && proposal.diff.ops.length > 0 : previewDoc !== null;
  const previewBannerVisible = previewDoc !== null || proposal !== null || proposalError !== null;
  const previewLocked = previewDoc !== null || proposal !== null;

  const applyStaged = useCallback(() => {
    if (proposal !== null) {
      if (proposalPreview?.state !== "ready" || proposal.diff.ops.length === 0) return;
      pushDiff({ ...proposal.diff, origin: `mcp/proposal:${proposal.proposalId}` });
      setProposal(null);
      setProposalError(null);
      return;
    }
    if (!compiled || compiled.diff.ops.length === 0) return;
    pushDiff({ ...compiled.diff, origin: "ai/dsl" });
    setDsl("");
  }, [compiled, proposal, proposalPreview, pushDiff]);

  const discardStaged = useCallback(() => {
    setDsl("");
    setProposal(null);
    setProposalError(null);
  }, []);
  const inventory = useMemo(() => toInventory(doc.graph), [doc.graph]);

  /** Inline inventory edit: one update_node diff per committed cell. */
  const editNodeField = useCallback(
    (nodeId: string, field: "label" | "type" | "ref" | "tags" | "description", raw: string) => {
      if (previewLocked) return;
      const node = history.doc.graph.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const next = { ...node } as Record<string, unknown>;
      const trimmed = raw.trim();
      if (field === "label") {
        if (trimmed === "") return; // labels are required
        next["label"] = raw;
      } else if (trimmed === "") {
        delete next[field];
      } else if (field === "tags") {
        next["tags"] = raw.split(",").map((t) => t.trim()).filter(Boolean);
      } else {
        next[field] = raw;
      }
      const op = makeNodeUpdate(node, next as unknown as Node);
      if (op) pushDiff({ origin: "user", summary: `edit ${nodeId}.${field}`, ops: [op] });
    },
    [history, previewLocked, pushDiff],
  );
  const matches = useMemo(() => searchNodes(doc.graph, query), [doc.graph, query]);
  const matchedIds = useMemo(() => new Set(matches.map((n) => n.id)), [matches]);
  const searchActive = query.trim() !== "";
  const activeSearchIndex =
    matches.length === 0 ? 0 : Math.min(searchIndex, matches.length - 1);
  const currentMatch = searchActive ? matches[activeSearchIndex] : undefined;
  const canvasSearch = useMemo(
    () =>
      searchActive
        ? {
            matchedNodeIds: matchedIds,
            ...(currentMatch !== undefined ? { currentNodeId: currentMatch.id } : {}),
          }
        : undefined,
    [currentMatch, matchedIds, searchActive],
  );
  const moveSearch = useCallback(
    (direction: -1 | 1) => {
      if (!searchActive || matches.length === 0) return;
      setSearchIndex((current) => {
        const normalized = Math.min(current, matches.length - 1);
        return (normalized + direction + matches.length) % matches.length;
      });
    },
    [matches.length, searchActive],
  );
  const selectedNode = useMemo(
    () => doc.graph.nodes.find((n) => selection.length === 1 && n.id === selection[0]),
    [doc.graph.nodes, selection],
  );
  const selectedTrace = useMemo(
    () =>
      selectedNode === undefined
        ? []
        : timelineRef.current.nodeHistory([selectedNode.ref ?? selectedNode.id]),
    [runtime, selectedNode, timelineRevision],
  );
  const selectedGroup = useMemo(
    () => doc.graph.groups.find((g) => groupSelection.length === 1 && g.id === groupSelection[0]),
    [doc.graph.groups, groupSelection],
  );
  const selectedEdge = useMemo(
    () => doc.graph.edges.find((e) => edgeSelection.length === 1 && e.id === edgeSelection[0]),
    [doc.graph.edges, edgeSelection],
  );

  const addNode = useCallback(
    (type: string) => {
      if (previewLocked) return;
      const current = history.doc;
      const existing = new Set(current.graph.nodes.map((n) => n.id));
      const id = freshId("n", existing);
      const base = typeLabel(type);
      const typeCount = current.graph.nodes.filter((n) => n.type === type).length;
      const label = typeCount === 0 ? base : `${base} ${typeCount + 1}`;
      // Place below the current diagram so new nodes never land on top of it.
      const placed = toFlow(current, viewId).nodes;
      const position =
        placed.length === 0
          ? { x: 80, y: 80 }
          : {
              x: Math.round(Math.min(...placed.map((n) => n.position.x))),
              y: Math.round(Math.max(...placed.map((n) => n.position.y))) + 100,
            };
      const view = current.views.find((v) => v.id === viewId) ?? current.views[0];
      const ops: DiffOp[] = [{ op: "add_node", node: { id, type, label } }];
      if (view) {
        ops.push({ op: "set_layout", viewId: view.id, nodeId: id, before: null, after: position });
      }
      pushDiff({ origin: "user", summary: `add ${type} "${label}"`, ops });
    },
    [history, previewLocked, pushDiff, viewId],
  );

  const connectSelected = useCallback(() => {
    if (selection.length !== 2 || previewLocked) return;
    const [source, target] = selection as [string, string];
    const existing = new Set(history.doc.graph.edges.map((e) => e.id));
    pushDiff({
      origin: "user",
      summary: `connect ${source} -> ${target}`,
      ops: [
        { op: "add_edge", edge: { id: freshId("e", existing), source, target, directed: true } },
      ],
    });
  }, [history, previewLocked, pushDiff, selection]);

  const duplicateSelected = useCallback(() => {
    if (selection.length === 0 || previewLocked) return;
    const positions: Record<string, NodeLayout> = {};
    for (const node of toFlow(history.doc, viewId).nodes) {
      if (!selection.includes(node.id)) continue;
      positions[node.id] = {
        ...node.position,
        ...(node.width !== undefined ? { width: node.width } : {}),
        ...(node.height !== undefined ? { height: node.height } : {}),
      };
    }
    const result = makeDuplicateNodes(history.doc, viewId, selection, { positions });
    if (result.diff.ops.length > 0) pushDiff(result.diff);
  }, [history, previewLocked, pushDiff, selection, viewId]);

  useEffect(() => {
    const handleDuplicateShortcut = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.key.toLowerCase() !== "d" ||
        (!event.metaKey && !event.ctrlKey) ||
        event.altKey ||
        tab !== "canvas"
      ) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))
      ) {
        return;
      }
      if (selection.length === 0 || previewLocked) return;
      event.preventDefault();
      duplicateSelected();
    };
    window.addEventListener("keydown", handleDuplicateShortcut);
    return () => window.removeEventListener("keydown", handleDuplicateShortcut);
  }, [duplicateSelected, previewLocked, selection.length, tab]);

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

  const deleteSelected = useCallback(() => {
    if (previewLocked) return;
    if (selection.length === 0 && edgeSelection.length === 0 && groupSelection.length === 0) return;
    const ops = makeRemoveOps(history.doc, {
      nodeIds: selection,
      edgeIds: edgeSelection,
      groupIds: groupSelection,
    });
    if (ops.length === 0) return;
    pushDiff({ origin: "user", summary: `delete selection`, ops });
  }, [edgeSelection, groupSelection, history, previewLocked, pushDiff, selection]);

  // Cmd/Ctrl+G groups the selection; Cmd/Ctrl+Shift+G ungroups the selected group.
  useEffect(() => {
    const handleGroupShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "g" || (!event.metaKey && !event.ctrlKey) || event.altKey || tab !== "canvas") {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))
      ) {
        return;
      }
      if (previewLocked) return;
      event.preventDefault();
      if (event.shiftKey) {
        ungroupSelected();
      } else {
        groupSelected();
      }
    };
    window.addEventListener("keydown", handleGroupShortcut);
    return () => window.removeEventListener("keydown", handleGroupShortcut);
  }, [groupSelected, previewLocked, tab, ungroupSelected]);

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

  // Cmd/Ctrl+S saves: remote PUT in shared mode, project save locally,
  // or prompts "save as project" for ephemeral diagrams.
  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "s" || (!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey) {
        return;
      }
      event.preventDefault();
      if (docSource) {
        saveRemote();
      } else if (project) {
        saveProjectDoc(project.id, historyRef.current.doc);
        setLocalSaveTick("saved");
      } else {
        saveAsProject();
      }
    };
    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [docSource, project, saveAsProject, saveRemote]);

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
  const exportDot = useCallback(
    () => download(`${doc.graph.id}.dot`, toDot(doc), "text/vnd.graphviz"),
    [doc, download],
  );
  const exportGraphML = useCallback(
    () => download(`${doc.graph.id}.graphml`, toGraphML(doc), "application/graphml+xml"),
    [doc, download],
  );
  const exportCsv = useCallback(
    () => download(`${doc.graph.id}.inventory.csv`, inventoryToCsv(inventory), "text/csv"),
    [doc.graph.id, download, inventory],
  );
  const exportRuntimeSnapshot = useCallback(() => {
    try {
      download(
        `${doc.graph.id}.topox-runtime.json`,
        serializeRuntimeSnapshot(timelineRef.current.toSnapshot()),
        "application/json",
      );
      setError(null);
    } catch (e) {
      setError(`snapshot export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [doc.graph.id, download]);
  const importRuntimeSnapshot = useCallback((raw: string) => {
    try {
      const snapshot = parseRuntimeSnapshot(raw);
      const timeline = new RuntimeTimeline({ checkpointInterval: 25 });
      timeline.loadSnapshot(snapshot);
      const range = timeline.range;
      const finalRuntime = range === null ? emptyRuntime() : timeline.stateAt(range.end);

      if (simulationTimerRef.current !== null) {
        clearInterval(simulationTimerRef.current);
        simulationTimerRef.current = null;
      }
      setSimulating(false);
      setPlaying(false);
      timelineRef.current = timeline;
      setTimelineRevision((revision) => revision + 1);
      setRuntime(finalRuntime);
      setReplayTs(range?.start ?? null);
      setError(null);
    } catch (e) {
      setError(`snapshot import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  return (
    <div style={styles.root}>
      <div style={styles.topbar}>
        <span style={styles.brand}>TopoX Studio</span>
        {docSource ? null : (
          <Dropdown
            label={
              project
                ? project.name.length > 20
                  ? `${project.name.slice(0, 19)}…`
                  : project.name
                : "Projects"
            }
            buttonStyle={styles.btn}
            items={[
              { label: "New project…", hint: "blank canvas", onSelect: newProject },
              ...(project === null
                ? [{ label: "Save as project…", hint: "keep this diagram", onSelect: saveAsProject }]
                : [
                    { label: "Rename project…", onSelect: renameCurrentProject },
                    { label: "Delete project", hint: "back to demo", onSelect: deleteCurrentProject },
                  ]),
              ...listProjects().map((meta) => ({
                label: meta.id === project?.id ? `● ${meta.name}` : meta.name,
                hint: new Date(meta.updatedAt).toLocaleDateString(),
                disabled: meta.id === project?.id,
                onSelect: () => openProject(meta),
              })),
            ]}
          />
        )}
        {docSource ? null : project ? (
          <span
            title="Changes auto-save to this browser (localStorage)"
            style={{ fontSize: 11.5, color: localSaveTick === "dirty" ? "var(--muted)" : "var(--ok)", whiteSpace: "nowrap" }}
          >
            {localSaveTick === "dirty" ? "Saving…" : "✓ Saved"}
          </span>
        ) : (
          <button
            style={{ ...styles.btn, color: "var(--warn-text)", borderColor: "var(--warn-border)" }}
            title="This diagram lives only in memory — save it as a project to keep it"
            onClick={saveAsProject}
          >
            Unsaved — Save…
          </button>
        )}
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
            ...(docSource
              ? []
              : [
                  project
                    ? {
                        label: "Save project",
                        hint: "auto-saves to browser",
                        onSelect: () => {
                          saveProjectDoc(project.id, historyRef.current.doc);
                          setLocalSaveTick("saved");
                        },
                      }
                    : { label: "Save as project…", hint: "keep in this browser", onSelect: saveAsProject },
                ]),
            {
              label: "Import…",
              hint: "json / yaml / mmd / dot / graphml",
              onSelect: () => fileInputRef.current?.click(),
            },
            {
              label: "Open proposal…",
              hint: ".topox-proposal.json",
              onSelect: () => proposalInputRef.current?.click(),
            },
            { label: "Export JSON", hint: ".topox.json", onSelect: exportJson },
            { label: "Export YAML", hint: ".topox.yaml", onSelect: exportYaml },
            { label: "Export Mermaid", hint: ".mmd", onSelect: exportMermaid },
            { label: "Export DOT", hint: ".dot", onSelect: exportDot },
            { label: "Export GraphML", hint: ".graphml", onSelect: exportGraphML },
            { label: "Export CSV inventory", hint: ".csv", onSelect: exportCsv },
            {
              label: "Load runtime snapshot…",
              hint: ".topox-runtime.json",
              onSelect: () => snapshotInputRef.current?.click(),
            },
            {
              label: "Save runtime snapshot",
              hint: timelineRange === null ? "run Simulate first" : ".topox-runtime.json",
              disabled: timelineRange === null,
              onSelect: exportRuntimeSnapshot,
            },
          ]}
        />
        <button style={styles.btn} disabled={previewLocked} onClick={() => setInsertOpen(true)}>
          Insert…
        </button>
        <Dropdown
          label="Arrange"
          buttonStyle={styles.btn}
          items={[
            { label: "Auto layout ↓", hint: "top → bottom", onSelect: () => autoLayout("TB") },
            { label: "Auto layout →", hint: "left → right", onSelect: () => autoLayout("LR") },
            { label: "Auto layout ↑", hint: "bottom → top", onSelect: () => autoLayout("BT") },
            { label: "Auto layout ←", hint: "right → left", onSelect: () => autoLayout("RL") },
            {
              label: "Connect selection",
              hint: "2 nodes → edge",
              disabled: selection.length !== 2 || previewLocked,
              onSelect: connectSelected,
            },
            {
              label: "Duplicate selection",
              hint: "⌘/Ctrl+D",
              disabled: selection.length === 0 || previewLocked,
              onSelect: duplicateSelected,
            },
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
              style={{ ...styles.btn, ...(dirty ? { borderColor: "var(--accent)", color: "var(--accent)" } : {}) }}
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
          <span style={{ display: "inline-flex", gap: 8, fontSize: 11, color: "var(--muted)" }}>
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
          accept=".json,.yaml,.yml,.mmd,.mermaid,.dot,.gv,.graphml"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            void file.text().then((raw) => importFile(file.name, raw));
            e.target.value = "";
          }}
        />
        <input
          ref={snapshotInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            void file.text().then(importRuntimeSnapshot, (readError: unknown) => {
              setError(
                `snapshot import failed: ${
                  readError instanceof Error ? readError.message : String(readError)
                }`,
              );
            });
            e.target.value = "";
          }}
        />
        <input
          ref={proposalInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            void file.text().then(openProposalFile, (readError: unknown) => {
              setProposalError(
                `proposal import failed: ${
                  readError instanceof Error ? readError.message : String(readError)
                }`,
              );
            });
            e.target.value = "";
          }}
        />
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
          <input
            placeholder="search nodes…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              moveSearch(e.shiftKey ? -1 : 1);
            }}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "5px 10px",
              fontSize: 12.5,
              width: 180,
            }}
          />
          {searchActive ? (
            <>
              <span
                aria-label="Search result position"
                style={{ minWidth: 38, textAlign: "center", color: "var(--muted)", fontSize: 11.5 }}
              >
                {matches.length === 0 ? "0 / 0" : `${activeSearchIndex + 1} / ${matches.length}`}
              </span>
              <button
                style={{ ...styles.btn, padding: "4px 7px" }}
                title="Previous search result"
                disabled={matches.length === 0}
                onClick={() => moveSearch(-1)}
              >
                ↑
              </button>
              <button
                style={{ ...styles.btn, padding: "4px 7px" }}
                title="Next search result"
                disabled={matches.length === 0}
                onClick={() => moveSearch(1)}
              >
                ↓
              </button>
            </>
          ) : null}
          <button
            style={{ ...styles.btn, padding: "4px 9px" }}
            onClick={theme.cycle}
            title={`Theme: ${theme.mode} (click to switch)`}
            aria-label="Toggle theme"
          >
            {theme.mode === "system" ? "◐ Auto" : theme.mode === "light" ? "☀ Light" : "☾ Dark"}
          </button>
        </div>
      </div>

      {error ? (
        <div style={{ background: "var(--danger-bg)", color: "var(--danger-text)", padding: "6px 14px", fontSize: 12.5 }}>
          {error}
        </div>
      ) : null}

      <div style={styles.main}>
        <div style={{ flex: 1, minWidth: 0, position: "relative", display: "flex", flexDirection: "column" }}>
          {previewBannerVisible && tab === "canvas" ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "6px 14px",
                background: "var(--warn-bg)",
                borderBottom: "1px solid var(--warn-border)",
                fontSize: 12.5,
              }}
            >
              <span style={{ fontWeight: 600, color: "var(--warn-text)" }}>
                {proposal !== null
                  ? `Proposal ${proposal.proposalId} · ${stagedOpCount} op(s) · ${proposalBaseState ?? "invalid"}`
                  : `Preview · ${stagedOpCount} op(s) staged`}
                {" — nothing applied yet"}
              </span>
              {proposal !== null ? (
                <span style={{ color: "var(--muted)", fontSize: 11, fontFamily: "ui-monospace, monospace" }}>
                  base {proposal.baseHash} · current {currentGraphHash}
                </span>
              ) : null}
              {proposalError !== null ? (
                <span style={{ color: "var(--danger)", fontSize: 12 }}>{proposalError}</span>
              ) : proposalPreview?.error !== undefined ? (
                <span style={{ color: "var(--danger)", fontSize: 12 }}>{proposalPreview.error}</span>
              ) : null}
              <button
                style={{
                  ...styles.btn,
                  background: canApplyPreview ? "var(--ok)" : "var(--surface)",
                  color: canApplyPreview ? "var(--inverse-text)" : "var(--muted)",
                  borderColor: canApplyPreview ? "var(--ok)" : "var(--border)",
                }}
                onClick={applyStaged}
                disabled={!canApplyPreview}
              >
                Apply
              </button>
              <button style={styles.btn} onClick={discardStaged}>Discard</button>
            </div>
          ) : null}
          <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          {tab === "canvas" ? (
            <>
            {doc.graph.nodes.length === 0 && !previewLocked ? (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  pointerEvents: "none",
                  zIndex: 10,
                }}
              >
                <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, lineHeight: 1.8 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>Empty canvas</div>
                  <div>Click <b>Insert…</b> to add your first node, or paste DSL in the AI panel.</div>
                  <div style={{ fontSize: 12 }}>Select two nodes and press Connect · ⌘G groups · ⌘D duplicates · ⌫ deletes</div>
                </div>
              </div>
            ) : null}
            <TopoCanvas
              doc={previewDoc ?? doc}
              viewId={viewId}
              onDiff={pushDiff}
              onSelect={handleSelect}
              readOnly={previewLocked}
              {...(previewDiffVisual !== undefined ? { diffVisual: previewDiffVisual } : {})}
              {...(resolvedRuntime !== undefined ? { runtime: resolvedRuntime } : {})}
              {...(canvasSearch !== undefined ? { search: canvasSearch } : {})}
              colorMode={theme.resolved}
            />
            {timelineRange !== null ? (
              <TimelineBar
                range={timelineRange}
                replayTs={replayTs}
                playing={playing}
                canStepBack={
                  timelineFrames.some((frame) => frame < (replayTs ?? timelineRange.end))
                }
                canStepForward={
                  replayTs !== null && timelineFrames.some((frame) => frame > replayTs)
                }
                onSeek={handleSeek}
                onStepBack={() => handleStep(-1)}
                onStepForward={() => handleStep(1)}
                onTogglePlay={handleTogglePlay}
                onLive={handleLive}
              />
            ) : null}
            {!previewLocked && (selection.length > 0 || edgeSelection.length > 0 || groupSelection.length > 0) ? (
              <div
                role="toolbar"
                aria-label="Selection actions"
                style={{
                  position: "absolute",
                  bottom: timelineRange !== null ? 64 : 16,
                  left: "50%",
                  transform: "translateX(-50%)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  borderRadius: 10,
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  boxShadow: "var(--shadow-panel)",
                  fontSize: 12.5,
                  zIndex: 20,
                }}
              >
                <span style={{ color: "var(--muted)", marginRight: 2 }}>
                  {selection.length + edgeSelection.length + groupSelection.length} selected
                </span>
                {selection.length === 2 ? (
                  <button style={styles.btn} onClick={connectSelected} title="Connect the two selected nodes">
                    Connect
                  </button>
                ) : null}
                {selection.length >= 2 ? (
                  <button style={styles.btn} onClick={groupSelected} title="Group selection (⌘G)">
                    Group
                  </button>
                ) : null}
                {selectedGroup ? (
                  <button style={styles.btn} onClick={ungroupSelected} title="Ungroup (⌘⇧G)">
                    Ungroup
                  </button>
                ) : null}
                {selectedGroup ? (
                  <button style={styles.btn} onClick={toggleSelectedGroup}>
                    {selectedGroup.collapsed === true ? "Expand" : "Collapse"}
                  </button>
                ) : null}
                {selection.length > 0 ? (
                  <button style={styles.btn} onClick={duplicateSelected} title="Duplicate (⌘D)">
                    Duplicate
                  </button>
                ) : null}
                <button
                  style={{ ...styles.btn, color: "var(--danger-text)" }}
                  onClick={deleteSelected}
                  title="Delete selection (⌫)"
                >
                  Delete
                </button>
              </div>
            ) : null}
            </>
          ) : tab === "inventory" ? (
            <div style={{ overflow: "auto", height: "100%", padding: 16 }}>
              <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8 }}>
                Click a cell to edit — label, type, ref, tags and description commit as undoable diffs.
              </div>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
                <thead>
                  <tr>
                    {["id", "type", "label", "ref", "tags", "group", "connections", "description"].map((h) => (
                      <th key={h} style={{ textAlign: "left", borderBottom: "2px solid var(--border)", padding: "6px 10px", position: "sticky", top: 0, background: "var(--surface)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inventory
                    .filter((r) => matchedIds.has(r.id))
                    .map((row) => (
                      <tr key={row.id}>
                        <td style={{ ...invCell, padding: "6px 10px", fontFamily: "monospace" }}>{row.id}</td>
                        <td style={invCell}>
                          <InventoryCell value={row.type} mono disabled={previewLocked} onCommit={(v) => editNodeField(row.id, "type", v)} />
                        </td>
                        <td style={invCell}>
                          <InventoryCell value={row.label} bold disabled={previewLocked} onCommit={(v) => editNodeField(row.id, "label", v)} />
                        </td>
                        <td style={invCell}>
                          <InventoryCell value={row.ref} mono disabled={previewLocked} onCommit={(v) => editNodeField(row.id, "ref", v)} />
                        </td>
                        <td style={invCell}>
                          <InventoryCell value={row.tags} disabled={previewLocked} onCommit={(v) => editNodeField(row.id, "tags", v)} />
                        </td>
                        <td style={{ ...invCell, padding: "6px 10px" }}>{row.group}</td>
                        <td style={{ ...invCell, padding: "6px 10px" }}>{row.connections}</td>
                        <td style={invCell}>
                          <InventoryCell value={row.description} disabled={previewLocked} onCommit={(v) => editNodeField(row.id, "description", v)} />
                        </td>
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
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {proposal !== null ? (
                <div style={panelBox}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Proposal</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
                    {proposal.proposalId} · {proposalBaseState ?? "invalid"} · {proposal.diff.ops.length} op(s)
                  </div>
                  <div style={{ maxHeight: 160, overflow: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
                    {proposal.summary.map((item, index) => (
                      <div key={index} style={{ fontFamily: "ui-monospace, monospace", fontSize: 11.5 }}>
                        <span
                          style={{
                            color: item.sign === "+" ? "var(--ok)" : item.sign === "-" ? "var(--danger)" : "var(--warning)",
                            fontWeight: 800,
                          }}
                        >
                          {item.sign}
                        </span>{" "}
                        {item.text}
                      </div>
                    ))}
                  </div>
                  {proposalPreview?.issues.length ? (
                    <div style={{ marginTop: 8, color: "var(--danger)", fontSize: 12 }}>
                      {proposalPreview.issues.filter((issue) => issue.severity === "error").length} error(s) after preview
                    </div>
                  ) : null}
                </div>
              ) : null}
              <AiPanel doc={doc} dsl={dsl} onDslChange={setDsl} compiled={compiled} />
            </div>
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
              nodeTrace={selectedTrace}
              multiCount={selection.length + edgeSelection.length + groupSelection.length}
              onDiff={pushDiff}
              onSeekTrace={handleSeek}
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
                <li key={i} style={{ marginBottom: 3, color: "var(--text-secondary)" }}>
                  <span style={{ color: "var(--muted-2)" }}>[{d.origin ?? "?"}]</span> {d.summary ?? `${d.ops.length} op(s)`}
                </li>
              ))}
            </ol>
          </section>

          <section style={{ marginTop: 16 }}>
            <h3 style={{ margin: "2px 0 8px", fontSize: 13 }}>Validation</h3>
            {issues.length === 0 ? (
              <div style={{ color: "var(--ok)" }}>✓ no issues</div>
            ) : (
              issues.map((issue, i) => (
                <div key={i} style={{ color: issue.severity === "error" ? "var(--danger)" : "var(--warning)", marginBottom: 3 }}>
                  [{issue.severity}] {issue.message}
                </div>
              ))
            )}
          </section>

          <section style={{ marginTop: 16, color: "var(--muted-2)" }}>
            {doc.graph.nodes.length} nodes · {doc.graph.edges.length} edges · {doc.graph.groups.length} groups
            {query ? ` · ${matches.length} match(es)` : ""}
          </section>
          </>
          )}
        </div>
      </div>
      {insertOpen ? (
        <IconPickerDialog
          title="Insert node"
          customLabel="Insert custom type"
          customPlaceholder="any type string, e.g. k8s-pod"
          onPick={(type) => {
            addNode(type);
            setInsertOpen(false);
          }}
          onClose={() => setInsertOpen(false)}
        />
      ) : null}
    </div>
  );
}
