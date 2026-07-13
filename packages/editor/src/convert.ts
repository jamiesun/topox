import type { Edge as RFEdge, Node as RFNode } from "@xyflow/react";
import type { TopoDoc, View } from "@topox/core";

export interface TopoNodeData extends Record<string, unknown> {
  label: string;
  nodeType: string;
  ref?: string;
  icon?: string;
}

export type TopoRFNode = RFNode<TopoNodeData>;

const DEFAULT_WIDTH = 150;
const DEFAULT_HEIGHT = 60;

/** Projects graph + view into React Flow shapes. Pure; called on every doc change. */
export function toFlow(doc: TopoDoc, viewId: string): { nodes: TopoRFNode[]; edges: RFEdge[] } {
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
      },
    };
  });

  const edges: RFEdge[] = doc.graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.label !== undefined ? { label: edge.label } : {}),
    ...(edge.directed ? { markerEnd: "url(#topox-arrow)" } : {}),
    style: { stroke: edge.color ?? "#9aa4b2", strokeWidth: 1.5 },
    type: "default",
  }));

  return { nodes, edges };
}
