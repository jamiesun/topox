import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Connection,
  type Edge as RFEdge,
  type EdgeChange,
  type Node as RFNode,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import type { DiffOp, GraphDiff, NodeStatus, ResolvedRuntime, TopoDoc } from "@topox/core";
import { makeMembershipCleanupOps, makeSetLayout } from "@topox/core";
import { Handle, Position } from "@xyflow/react";
import {
  flowIdToGroupId,
  formatMetrics,
  toFlow,
  transitiveNodeMembers,
  type TopoGroupData,
  type TopoNodeData,
  type TopoRFNode,
} from "./convert.js";

export interface TopoCanvasProps {
  doc: TopoDoc;
  viewId: string;
  /** Every edit leaves the canvas as a diff. The canvas owns no document state. */
  onDiff: (diff: GraphDiff) => void;
  onSelect?: (nodeIds: string[], edgeIds: string[], groupIds?: string[]) => void;
  readOnly?: boolean;
  /** Live overlay (resolveRuntime output). Purely visual; never enters diffs. */
  runtime?: ResolvedRuntime;
}

export const statusPalette: Record<NodeStatus, string> = {
  running: "#16a34a",
  waiting: "#d97706",
  stopped: "#94a3b8",
  error: "#dc2626",
  offline: "#475569",
};

const typePalette: Record<string, string> = {
  "net-router": "#2563eb",
  "net-mikrotik": "#2563eb",
  "net-switch": "#0891b2",
  "net-firewall": "#dc2626",
  "net-server": "#7c3aed",
  "net-cloud": "#64748b",
  "net-database": "#b45309",
  "net-cpe": "#059669",
  "net-wifi": "#0ea5e9",
  "net-terminal": "#334155",
};

const TopoNode = memo(function TopoNode({ data, selected }: NodeProps<TopoRFNode>) {
  const d = data as TopoNodeData;
  const accent = typePalette[d.nodeType] ?? "#475569";
  const statusColor = d.status !== undefined ? statusPalette[d.status] : undefined;
  const borderColor =
    d.status === "error" ? statusPalette.error : selected ? accent : "#d0d7de";
  return (
    <div
      style={{
        border: `1.5px solid ${borderColor}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: 8,
        background: "#fff",
        padding: "8px 12px",
        minWidth: 120,
        boxShadow: selected ? `0 0 0 3px ${accent}22` : "0 1px 2px rgba(0,0,0,.06)",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        opacity: d.status === "offline" ? 0.55 : 1,
        position: "relative",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0.4 }} />
      {statusColor !== undefined ? (
        <span
          title={`${d.status}${d.message !== undefined ? `: ${d.message}` : ""}`}
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: statusColor,
            boxShadow: `0 0 0 3px ${statusColor}33`,
          }}
        />
      ) : null}
      <div style={{ fontSize: 10, color: accent, fontWeight: 600, letterSpacing: 0.4 }}>
        {d.nodeType}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#1f2d3d" }}>{d.label}</div>
      {d.ref ? (
        <div style={{ fontSize: 10, color: "#8b95a1", marginTop: 2 }}>{d.ref}</div>
      ) : null}
      {d.metrics !== undefined ? (
        <div style={{ fontSize: 10, color: "#475569", marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
          {formatMetrics(d.metrics)}
        </div>
      ) : null}
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0.4 }} />
    </div>
  );
});

interface GroupActions {
  toggle: (groupId: string, collapsed: boolean) => void;
  readOnly: boolean;
}

const GroupActionsContext = createContext<GroupActions>({ toggle: () => {}, readOnly: true });

const toggleButtonStyle: CSSProperties = {
  border: "1px solid #cbd5e1",
  borderRadius: 5,
  background: "#fff",
  cursor: "pointer",
  fontSize: 11,
  lineHeight: "16px",
  padding: "0 5px",
  color: "#475569",
};

const TopoGroupNode = memo(function TopoGroupNode({ data, selected }: NodeProps<TopoRFNode>) {
  const d = data as TopoGroupData;
  const { toggle, readOnly } = useContext(GroupActionsContext);

  if (d.kind === "container") {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          border: `1.5px dashed ${selected ? "#6366f1" : "#b6c2d2"}`,
          borderRadius: 12,
          background: selected ? "rgba(99,102,241,0.06)" : "rgba(148,163,184,0.07)",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            fontSize: 11,
            fontWeight: 700,
            color: "#64748b",
            letterSpacing: 0.3,
          }}
        >
          {!readOnly ? (
            <button
              type="button"
              title="Collapse group"
              style={toggleButtonStyle}
              onClick={(e) => {
                e.stopPropagation();
                toggle(d.groupId, true);
              }}
            >
              ▾
            </button>
          ) : null}
          <span>{d.label}</span>
          <span style={{ fontWeight: 500, color: "#94a3b8" }}>({d.memberCount})</span>
        </div>
      </div>
    );
  }

  // proxy: collapsed group stands in for its hidden members
  const summary = d.statusSummary;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        border: `1.5px solid ${selected ? "#6366f1" : "#b6c2d2"}`,
        borderRadius: 10,
        background: "linear-gradient(#f8fafc, #eef2f7)",
        boxShadow: selected
          ? "0 0 0 3px rgba(99,102,241,0.15)"
          : "2px 2px 0 #dbe2ea, 4px 4px 0 #e8edf3",
        padding: "8px 12px",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        boxSizing: "border-box",
        position: "relative",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0.4 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {!readOnly ? (
          <button
            type="button"
            title="Expand group"
            style={toggleButtonStyle}
            onClick={(e) => {
              e.stopPropagation();
              toggle(d.groupId, false);
            }}
          >
            ▸
          </button>
        ) : null}
        <span style={{ fontSize: 12, fontWeight: 700, color: "#334155" }}>{d.label}</span>
      </div>
      <div style={{ fontSize: 10, color: "#8b95a1", marginTop: 3, display: "flex", gap: 8 }}>
        <span>{d.memberCount} nodes</span>
        {summary !== undefined ? (
          <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
            {(Object.entries(summary) as [NodeStatus, number][]).map(([st, count]) => (
              <span key={st} style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: statusPalette[st],
                    display: "inline-block",
                  }}
                />
                {count}
              </span>
            ))}
          </span>
        ) : null}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0.4 }} />
    </div>
  );
});

const nodeTypes = { topo: TopoNode, topoGroup: TopoGroupNode };

let edgeSeq = 0;
function nextEdgeId(existing: Set<string>): string {
  let id = `e-${Date.now().toString(36)}-${(edgeSeq += 1)}`;
  while (existing.has(id)) id = `e-${Date.now().toString(36)}-${(edgeSeq += 1)}`;
  return id;
}

/**
 * TopoCanvas is a controlled component: doc in, diffs out.
 * It renders the given View's layout and translates canvas gestures into GraphDiffs.
 */
export function TopoCanvas({ doc, viewId, onDiff, onSelect, readOnly = false, runtime }: TopoCanvasProps) {
  const view = doc.views.find((v) => v.id === viewId) ?? doc.views[0];

  // React Flow's controlled-flow pattern: the canvas owns transient interaction
  // state (drag positions, selection) locally so dragging stays at 60fps; the
  // document is only touched once, as a diff, when the gesture ends.
  const [flow, setFlow] = useState(() => toFlow(doc, viewId, runtime));
  const mounted = useRef(false);
  // Positions at drag start, for proxy drags (delta moves all hidden members).
  const dragStart = useRef<Map<string, { x: number; y: number }>>(new Map());

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return; // initial state already computed
    }
    const fresh = toFlow(doc, viewId, runtime);
    setFlow((prev) => {
      const prevNodes = new Map(prev.nodes.map((n) => [n.id, n]));
      const prevEdges = new Map(prev.edges.map((e) => [e.id, e]));
      return {
        // Preserve in-flight drag positions and selection across doc/runtime
        // refreshes (e.g. simulator ticks) so gestures are never interrupted.
        nodes: fresh.nodes.map((n) => {
          const p = prevNodes.get(n.id);
          if (!p) return n;
          const merged: TopoRFNode = { ...n, selected: p.selected ?? false };
          if (p.dragging === true) {
            merged.position = p.position;
            merged.dragging = true;
          }
          return merged;
        }),
        edges: fresh.edges.map((e) => {
          const p = prevEdges.get(e.id);
          return p ? { ...e, selected: p.selected ?? false } : e;
        }),
      };
    });
  }, [doc, viewId, runtime]);

  const handleNodesChange = useCallback((changes: NodeChange<TopoRFNode>[]) => {
    // Removals go through the diff pipeline (onDelete), never the local state,
    // so the document stays the single source of truth.
    const safe = changes.filter((c) => c.type !== "remove");
    if (safe.length === 0) return;
    setFlow((prev) => ({ ...prev, nodes: applyNodeChanges(safe, prev.nodes) }));
  }, []);

  const handleEdgesChange = useCallback((changes: EdgeChange<RFEdge>[]) => {
    const safe = changes.filter((c) => c.type !== "remove");
    if (safe.length === 0) return;
    setFlow((prev) => ({ ...prev, edges: applyEdgeChanges(safe, prev.edges) }));
  }, []);

  const handleNodeDragStart = useCallback((_event: unknown, _node: RFNode, dragged: RFNode[]) => {
    dragStart.current = new Map(dragged.map((n) => [n.id, { ...n.position }]));
  }, []);

  const handleNodeDragStop = useCallback(
    (_event: unknown, _node: RFNode, dragged: RFNode[]) => {
      if (readOnly || !view) return;
      const ops: DiffOp[] = [];
      for (const node of dragged) {
        const groupId = flowIdToGroupId(node.id);
        if (groupId !== null) {
          // Proxy drag: translate every hidden member by the drag delta so the
          // group's internal geometry survives collapse/expand round-trips.
          const start = dragStart.current.get(node.id);
          if (!start) continue;
          const dx = Math.round(node.position.x - start.x);
          const dy = Math.round(node.position.y - start.y);
          if (dx === 0 && dy === 0) continue;
          for (const member of transitiveNodeMembers(doc.graph, groupId)) {
            const before = view.layout[member];
            if (!before) continue; // fallback-grid nodes keep deriving positions
            ops.push(makeSetLayout(view, member, { ...before, x: before.x + dx, y: before.y + dy }));
          }
          continue;
        }
        const before = view.layout[node.id];
        const next = {
          x: Math.round(node.position.x),
          y: Math.round(node.position.y),
          ...(before?.width !== undefined ? { width: before.width } : {}),
          ...(before?.height !== undefined ? { height: before.height } : {}),
        };
        if (before && before.x === next.x && before.y === next.y) continue;
        ops.push(makeSetLayout(view, node.id, next));
      }
      if (ops.length === 0) return;
      onDiff({
        origin: "user",
        summary:
          dragged.length === 1
            ? `move ${flowIdToGroupId(dragged[0]?.id ?? "") ?? dragged[0]?.id ?? "node"}`
            : `move ${dragged.length} items`,
        ops,
      });
    },
    [doc.graph, onDiff, readOnly, view],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (readOnly || !connection.source || !connection.target) return;
      // Edges live between nodes; proxies are views, not entities.
      if (flowIdToGroupId(connection.source) !== null || flowIdToGroupId(connection.target) !== null)
        return;
      const existing = new Set(doc.graph.edges.map((e) => e.id));
      onDiff({
        origin: "user",
        summary: `connect ${connection.source} -> ${connection.target}`,
        ops: [
          {
            op: "add_edge",
            edge: {
              id: nextEdgeId(existing),
              source: connection.source,
              target: connection.target,
              directed: true,
            },
          },
        ],
      });
    },
    [doc.graph.edges, onDiff, readOnly],
  );

  const handleDelete = useCallback(
    (params: { nodes: RFNode[]; edges: RFEdge[] }) => {
      if (readOnly) return;
      const groupIds = new Set(
        params.nodes.map((n) => flowIdToGroupId(n.id)).filter((g): g is string => g !== null),
      );
      const nodeIds = new Set(params.nodes.map((n) => n.id).filter((id) => flowIdToGroupId(id) === null));
      const removedEdges = doc.graph.edges.filter(
        (e) => params.edges.some((re) => re.id === e.id) || nodeIds.has(e.source) || nodeIds.has(e.target),
      );
      const removedNodes = doc.graph.nodes.filter((n) => nodeIds.has(n.id));
      // Deleting a group dissolves the grouping; members stay.
      const removedGroups = doc.graph.groups.filter((g) => groupIds.has(g.id));
      if (removedEdges.length === 0 && removedNodes.length === 0 && removedGroups.length === 0) return;
      // Surviving groups must not point at removed nodes/groups.
      const removedIds = new Set<string>([...nodeIds, ...removedGroups.map((g) => g.id)]);
      const cleanupOps = makeMembershipCleanupOps(doc.graph, removedIds);
      onDiff({
        origin: "user",
        summary: `delete ${removedNodes.length} node(s), ${removedEdges.length} edge(s)${
          removedGroups.length > 0 ? `, ${removedGroups.length} group(s)` : ""
        }`,
        ops: [
          ...removedEdges.map((edge) => ({ op: "remove_edge" as const, edge })),
          ...removedNodes.map((node) => ({ op: "remove_node" as const, node })),
          ...removedGroups.map((group) => ({ op: "remove_group" as const, group })),
          ...cleanupOps,
        ],
      });
    },
    [doc.graph.edges, doc.graph.groups, doc.graph.nodes, onDiff, readOnly],
  );

  const handleSelectionChange = useCallback(
    (params: { nodes: RFNode[]; edges: RFEdge[] }) => {
      const nodeIds: string[] = [];
      const groupIds: string[] = [];
      for (const n of params.nodes) {
        const g = flowIdToGroupId(n.id);
        if (g !== null) groupIds.push(g);
        else nodeIds.push(n.id);
      }
      onSelect?.(
        nodeIds,
        params.edges.map((e) => e.id),
        groupIds,
      );
    },
    [onSelect],
  );

  const toggleGroup = useCallback(
    (groupId: string, collapsed: boolean) => {
      if (readOnly) return;
      const group = doc.graph.groups.find((g) => g.id === groupId);
      if (!group || (group.collapsed ?? false) === collapsed) return;
      onDiff({
        origin: "user",
        summary: `${collapsed ? "collapse" : "expand"} group ${group.label}`,
        ops: [
          {
            op: "update_group",
            id: groupId,
            before: { collapsed: group.collapsed ?? null },
            after: { collapsed },
          },
        ],
      });
    },
    [doc.graph.groups, onDiff, readOnly],
  );

  const actionsValue = useMemo<GroupActions>(
    () => ({ toggle: toggleGroup, readOnly }),
    [toggleGroup, readOnly],
  );

  return (
    <GroupActionsContext.Provider value={actionsValue}>
      <ReactFlow
        nodes={flow.nodes}
        edges={flow.edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onConnect={handleConnect}
        onDelete={handleDelete}
        onSelectionChange={handleSelectionChange}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable
        fitView
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
      >
        <svg style={{ position: "absolute", width: 0, height: 0 }}>
          <defs>
            <marker
              id="topox-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#9aa4b2" />
            </marker>
          </defs>
        </svg>
        <Background gap={16} color="#e5e9ef" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </GroupActionsContext.Provider>
  );
}
