import type { GraphDiff, Node, NodeLayout, TopoDoc } from "./types.js";

export interface DuplicateNodesOptions {
  offset?: Pick<NodeLayout, "x" | "y">;
  positions?: Record<string, NodeLayout | undefined>;
}

export interface DuplicateNodesResult {
  diff: GraphDiff;
  nodeIds: string[];
}

const DEFAULT_DUPLICATE_OFFSET = { x: 32, y: 32 };

function copyNode(node: Node, id: string): Node {
  const copy = { ...node, id };
  if (node.tags !== undefined) copy.tags = [...node.tags];
  if (node.attrs !== undefined) copy.attrs = structuredClone(node.attrs);
  return copy;
}

export function makeDuplicateNodes(
  doc: TopoDoc,
  viewId: string,
  nodeIds: string[],
  options: DuplicateNodesOptions = {},
): DuplicateNodesResult {
  const view = doc.views.find((candidate) => candidate.id === viewId);
  if (!view) throw new Error(`unknown view ${viewId}`);

  const sources: Node[] = [];
  const selected = new Set<string>();
  for (const nodeId of nodeIds) {
    if (selected.has(nodeId)) continue;
    const node = doc.graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) throw new Error(`unknown node ${nodeId}`);
    selected.add(nodeId);
    sources.push(node);
  }

  const usedIds = new Set([
    ...doc.graph.nodes.map((node) => node.id),
    ...doc.graph.groups.map((group) => group.id),
  ]);
  const copies = new Map<string, Node>();
  for (const source of sources) {
    let suffix = 1;
    let id = `${source.id}-copy`;
    while (usedIds.has(id)) {
      suffix += 1;
      id = `${source.id}-copy-${suffix}`;
    }
    usedIds.add(id);
    copies.set(source.id, copyNode(source, id));
  }

  const offset = options.offset ?? DEFAULT_DUPLICATE_OFFSET;
  const ops: GraphDiff["ops"] = [];
  for (const copy of copies.values()) {
    ops.push({ op: "add_node", node: copy });
  }
  for (const [sourceId, copy] of copies) {
    const sourceLayout = options.positions?.[sourceId] ?? view.layout[sourceId];
    if (!sourceLayout) continue;
    ops.push({
      op: "set_layout",
      viewId,
      nodeId: copy.id,
      before: null,
      after: {
        ...sourceLayout,
        x: sourceLayout.x + offset.x,
        y: sourceLayout.y + offset.y,
      },
    });
  }
  for (const group of doc.graph.groups) {
    const children = group.children.flatMap((childId) => {
      const copy = copies.get(childId);
      return copy ? [childId, copy.id] : [childId];
    });
    if (children.length === group.children.length) continue;
    ops.push({
      op: "update_group",
      id: group.id,
      before: { children: group.children },
      after: { children },
    });
  }

  const count = copies.size;
  return {
    nodeIds: [...copies.values()].map((node) => node.id),
    diff: {
      origin: "user",
      summary: `duplicate ${count} ${count === 1 ? "node" : "nodes"}`,
      ops,
    },
  };
}
