import type { DiffOp, Graph, Group, TopoDoc } from "./types.js";
import { makeGroupUpdate, makeSetLayout } from "./diff.js";

/**
 * Ops to create a group. Members are pulled out of any current parent first,
 * preserving the single-parent invariant enforced by validateDoc.
 */
export function makeGroupOps(graph: Graph, group: Group): DiffOp[] {
  const members = new Set(group.children);
  const ops: DiffOp[] = [];
  for (const g of graph.groups) {
    if (!g.children.some((c) => members.has(c))) continue;
    const op = makeGroupUpdate(g, { ...g, children: g.children.filter((c) => !members.has(c)) });
    if (op) ops.push(op);
  }
  ops.push({ op: "add_group", group });
  return ops;
}

/** Ops to dissolve a group, promoting its children into the parent group (if any). */
export function makeUngroupOps(graph: Graph, groupId: string): DiffOp[] {
  const group = graph.groups.find((g) => g.id === groupId);
  if (!group) return [];
  const ops: DiffOp[] = [];
  const parent = graph.groups.find((g) => g.children.includes(groupId));
  if (parent) {
    const op = makeGroupUpdate(parent, {
      ...parent,
      children: [...parent.children.filter((c) => c !== groupId), ...group.children],
    });
    if (op) ops.push(op);
  }
  ops.push({ op: "remove_group", group });
  return ops;
}

/**
 * Builds a complete, invertible removal diff for the given nodes/edges/groups.
 * The kernel refuses to remove entities that are still referenced, so ops are
 * ordered to satisfy every strict check on apply *and* on undo:
 * surviving-group membership cleanup → edges (selected plus any touching a
 * removed node) → view layout entries → groups (parents before children) →
 * nodes. Removing a group dissolves it; surviving children stay in the graph.
 * Unknown ids are ignored.
 */
export function makeRemoveOps(
  doc: TopoDoc,
  selection: {
    nodeIds?: readonly string[];
    edgeIds?: readonly string[];
    groupIds?: readonly string[];
  },
): DiffOp[] {
  const wantNodes = new Set(selection.nodeIds ?? []);
  const wantEdges = new Set(selection.edgeIds ?? []);
  const wantGroups = new Set(selection.groupIds ?? []);

  const nodes = doc.graph.nodes.filter((n) => wantNodes.has(n.id));
  const groups = doc.graph.groups.filter((g) => wantGroups.has(g.id));
  const removedNodeIds = new Set(nodes.map((n) => n.id));
  const removedIds = new Set([...removedNodeIds, ...groups.map((g) => g.id)]);

  const edges = doc.graph.edges.filter(
    (e) => wantEdges.has(e.id) || removedNodeIds.has(e.source) || removedNodeIds.has(e.target),
  );

  const depthOf = (id: string): number => {
    let depth = 0;
    let current = id;
    const seen = new Set<string>();
    while (!seen.has(current)) {
      seen.add(current);
      const parent = doc.graph.groups.find((p) => p.children.includes(current));
      if (!parent) break;
      current = parent.id;
      depth += 1;
    }
    return depth;
  };

  const ops: DiffOp[] = [];
  ops.push(...makeMembershipCleanupOps(doc.graph, removedIds));
  for (const edge of edges) ops.push({ op: "remove_edge", edge });
  for (const view of doc.views) {
    for (const id of removedNodeIds) {
      if (id in view.layout) ops.push(makeSetLayout(view, id, null));
    }
  }
  for (const group of [...groups].sort((a, b) => depthOf(a.id) - depthOf(b.id)))
    ops.push({ op: "remove_group", group });
  for (const node of nodes) ops.push({ op: "remove_node", node });
  return ops;
}

/** Ops pruning removed entity ids out of surviving groups' children lists. */
export function makeMembershipCleanupOps(
  graph: Graph,
  removedIds: ReadonlySet<string>,
): DiffOp[] {
  const ops: DiffOp[] = [];
  for (const g of graph.groups) {
    if (removedIds.has(g.id)) continue;
    if (!g.children.some((c) => removedIds.has(c))) continue;
    const op = makeGroupUpdate(g, { ...g, children: g.children.filter((c) => !removedIds.has(c)) });
    if (op) ops.push(op);
  }
  return ops;
}
