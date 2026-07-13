import type { Edge as RFEdge, Node as RFNode } from "@xyflow/react";
import type {
  MetricValue,
  NodeStatus,
  ResolvedRuntime,
  TopoDoc,
  View,
} from "@topox/core";

export interface TopoNodeData extends Record<string, unknown> {
  label: string;
  nodeType: string;
  ref?: string;
  icon?: string;
  /** Live overlay — resolved runtime, never stored in the doc. */
  status?: NodeStatus;
  message?: string;
  metrics?: Record<string, MetricValue>;
}

export type TopoRFNode = RFNode<TopoNodeData>;

const DEFAULT_WIDTH = 150;
const DEFAULT_HEIGHT = 60;

export function formatMetrics(metrics: Record<string, MetricValue>, max = 3): string {
  return Object.entries(metrics)
    .slice(0, max)
    .map(([k, v]) => `${k} ${typeof v === "number" ? +v.toFixed(1) : v}`)
    .join(" · ");
}

/** Projects graph + view (+ optional runtime overlay) into React Flow shapes. Pure. */
export function toFlow(
  doc: TopoDoc,
  viewId: string,
  runtime?: ResolvedRuntime,
): { nodes: TopoRFNode[]; edges: RFEdge[] } {
  const view: View | undefined = doc.views.find((v) => v.id === viewId) ?? doc.views[0];
  const layout = view?.layout ?? {};

  // Nodes without a stored layout get a deterministic fallback grid position.
  let fallbackIndex = 0;
  const nodes: TopoRFNode[] = doc.graph.nodes.map((node) => {
    const pos = layout[node.id];
    const fallback = {
      x: (fallbackIndex % 5) * 200 + 40,
      y: Math.floor(fallbackIndex / 5) * 120 + 40,
    };
    if (!pos) fallbackIndex += 1;
    const rt = runtime?.nodes.get(node.id);
    return {
      id: node.id,
      type: "topo",
      position: pos ? { x: pos.x, y: pos.y } : fallback,
      width: pos?.width ?? DEFAULT_WIDTH,
      height: pos?.height ?? DEFAULT_HEIGHT,
      data: {
        label: node.label,
        nodeType: node.type,
        ...(node.ref !== undefined ? { ref: node.ref } : {}),
        ...(node.icon !== undefined ? { icon: node.icon } : {}),
        ...(rt?.status !== undefined ? { status: rt.status } : {}),
        ...(rt?.message !== undefined ? { message: rt.message } : {}),
        ...(rt?.metrics !== undefined ? { metrics: rt.metrics } : {}),
      },
    };
  });

  const edges: RFEdge[] = doc.graph.edges.map((edge) => {
    const rt = runtime?.edges.get(edge.id);
    const liveLabel = rt?.metrics !== undefined ? formatMetrics(rt.metrics, 2) : undefined;
    const label = liveLabel ?? edge.label;
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(label !== undefined ? { label } : {}),
      ...(edge.directed ? { markerEnd: "url(#topox-arrow)" } : {}),
      ...(rt?.active === true ? { animated: true } : {}),
      style: {
        stroke: edge.color ?? (rt?.active === true ? "#2563eb" : "#9aa4b2"),
        strokeWidth: rt?.active === true ? 2 : 1.5,
      },
      ...(liveLabel !== undefined
        ? { labelStyle: { fill: "#2563eb", fontWeight: 600, fontSize: 10 } }
        : {}),
      type: "default",
    };
  });

  return { nodes, edges };
}
