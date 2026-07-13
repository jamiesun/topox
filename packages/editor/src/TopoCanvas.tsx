import { useCallback, useMemo } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Connection,
  type Edge as RFEdge,
  type Node as RFNode,
  type NodeProps,
} from "@xyflow/react";
import type { GraphDiff, NodeStatus, ResolvedRuntime, TopoDoc } from "@topox/core";
import { makeSetLayout } from "@topox/core";
import { Handle, Position } from "@xyflow/react";
import { formatMetrics, toFlow, type TopoNodeData, type TopoRFNode } from "./convert.js";

export interface TopoCanvasProps {
  doc: TopoDoc;
  viewId: string;
  /** Every edit leaves the canvas as a diff. The canvas owns no document state. */
  onDiff: (diff: GraphDiff) => void;
  onSelect?: (nodeIds: string[], edgeIds: string[]) => void;
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

function TopoNode({ data, selected }: NodeProps<TopoRFNode>) {
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
}

const nodeTypes = { topo: TopoNode };

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
  const { nodes, edges } = useMemo(() => toFlow(doc, viewId, runtime), [doc, viewId, runtime]);
  const view = doc.views.find((v) => v.id === viewId) ?? doc.views[0];

  const handleNodeDragStop = useCallback(
    (_event: unknown, node: RFNode) => {
      if (readOnly || !view) return;
      const before = view.layout[node.id];
      const next = {
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
        ...(before?.width !== undefined ? { width: before.width } : {}),
        ...(before?.height !== undefined ? { height: before.height } : {}),
      };
      if (before && before.x === next.x && before.y === next.y) return;
      onDiff({
        origin: "user",
        summary: `move ${node.id}`,
        ops: [makeSetLayout(view, node.id, next)],
      });
    },
    [onDiff, readOnly, view],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (readOnly || !connection.source || !connection.target) return;
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
      const nodeIds = new Set(params.nodes.map((n) => n.id));
      const removedEdges = doc.graph.edges.filter(
        (e) => params.edges.some((re) => re.id === e.id) || nodeIds.has(e.source) || nodeIds.has(e.target),
      );
      const removedNodes = doc.graph.nodes.filter((n) => nodeIds.has(n.id));
      if (removedEdges.length === 0 && removedNodes.length === 0) return;
      onDiff({
        origin: "user",
        summary: `delete ${removedNodes.length} node(s), ${removedEdges.length} edge(s)`,
        ops: [
          ...removedEdges.map((edge) => ({ op: "remove_edge" as const, edge })),
          ...removedNodes.map((node) => ({ op: "remove_node" as const, node })),
        ],
      });
    },
    [doc.graph.edges, doc.graph.nodes, onDiff, readOnly],
  );

  const handleSelectionChange = useCallback(
    (params: { nodes: RFNode[]; edges: RFEdge[] }) => {
      onSelect?.(
        params.nodes.map((n) => n.id),
        params.edges.map((e) => e.id),
      );
    },
    [onSelect],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
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
  );
}
