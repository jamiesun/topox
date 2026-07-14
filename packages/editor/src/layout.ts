import dagre from "@dagrejs/dagre";
import type { GraphDiff, TopoDoc } from "@talkincode/topox-core";
import { makeSetLayout } from "@talkincode/topox-core";

export type LayoutDirection = "TB" | "BT" | "LR" | "RL";

export interface AutoLayoutOptions {
  direction?: LayoutDirection;
  nodeWidth?: number;
  nodeHeight?: number;
  gapX?: number;
  gapY?: number;
}

/**
 * Dagre auto-layout. Returns a GraphDiff of set_layout ops — layout changes go
 * through the same diff pipeline as everything else, so they preview and undo.
 */
export function autoLayoutDiff(
  doc: TopoDoc,
  viewId: string,
  options: AutoLayoutOptions = {},
): GraphDiff {
  const view = doc.views.find((v) => v.id === viewId);
  if (!view) return { summary: "auto layout (view not found)", ops: [] };

  const { direction = "TB", nodeWidth = 150, nodeHeight = 60, gapX = 60, gapY = 70 } = options;

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: gapX, ranksep: gapY });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of doc.graph.nodes) {
    const existing = view.layout[node.id];
    g.setNode(node.id, {
      width: existing?.width ?? nodeWidth,
      height: existing?.height ?? nodeHeight,
    });
  }
  for (const edge of doc.graph.edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const ops = doc.graph.nodes.flatMap((node) => {
    const placed = g.node(node.id);
    if (!placed) return [];
    const existing = view.layout[node.id];
    const next = {
      // dagre positions are centers; React Flow uses top-left corners.
      x: Math.round(placed.x - placed.width / 2),
      y: Math.round(placed.y - placed.height / 2),
      ...(existing?.width !== undefined ? { width: existing.width } : {}),
      ...(existing?.height !== undefined ? { height: existing.height } : {}),
    };
    if (existing && existing.x === next.x && existing.y === next.y) return [];
    return [makeSetLayout(view, node.id, next)];
  });

  return { origin: "layout:dagre", summary: `auto layout (${direction})`, ops };
}
