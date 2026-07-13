import type { DiffOp, Graph, Group } from "./types.js";
import { makeGroupUpdate } from "./diff.js";

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
