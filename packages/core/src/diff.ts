import type {
  DiffOp,
  Edge,
  GraphDiff,
  Group,
  Node,
  NodeLayout,
  Patch,
  TopoDoc,
  View,
} from "./types.js";

/** Thrown when a diff cannot be applied to the given document. */
export class DiffConflictError extends Error {
  readonly op: DiffOp;
  constructor(op: DiffOp, message: string) {
    super(message);
    this.name = "DiffConflictError";
    this.op = op;
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function applyPatch<T extends object>(entity: T, patch: Patch<T>): T {
  const next = { ...(entity as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = clone(value);
  }
  return next as T;
}

function invertOp(op: DiffOp): DiffOp {
  switch (op.op) {
    case "add_node":
      return { op: "remove_node", node: op.node };
    case "remove_node":
      return { op: "add_node", node: op.node };
    case "update_node":
      return { op: "update_node", id: op.id, before: op.after, after: op.before };
    case "add_edge":
      return { op: "remove_edge", edge: op.edge };
    case "remove_edge":
      return { op: "add_edge", edge: op.edge };
    case "update_edge":
      return { op: "update_edge", id: op.id, before: op.after, after: op.before };
    case "add_group":
      return { op: "remove_group", group: op.group };
    case "remove_group":
      return { op: "add_group", group: op.group };
    case "update_group":
      return { op: "update_group", id: op.id, before: op.after, after: op.before };
    case "update_meta":
      return { op: "update_meta", before: op.after, after: op.before };
    case "add_view":
      return { op: "remove_view", view: op.view };
    case "remove_view":
      return { op: "add_view", view: op.view };
    case "set_layout":
      return { ...op, before: op.after, after: op.before };
  }
}

/** Inverting a diff reverses op order and flips each op. Undo comes for free. */
export function invertDiff(diff: GraphDiff): GraphDiff {
  return {
    ...(diff.origin !== undefined ? { origin: diff.origin } : {}),
    summary: diff.summary !== undefined ? `undo: ${diff.summary}` : "undo",
    ops: [...diff.ops].reverse().map(invertOp),
  };
}

function upsertFail(op: DiffOp, msg: string): never {
  throw new DiffConflictError(op, msg);
}

function applyOp(doc: TopoDoc, op: DiffOp): TopoDoc {
  switch (op.op) {
    case "add_node": {
      if (doc.graph.nodes.some((n) => n.id === op.node.id))
        upsertFail(op, `add_node: id ${op.node.id} already exists`);
      return {
        ...doc,
        graph: { ...doc.graph, nodes: [...doc.graph.nodes, clone(op.node)] },
      };
    }
    case "remove_node": {
      if (!doc.graph.nodes.some((n) => n.id === op.node.id))
        upsertFail(op, `remove_node: id ${op.node.id} not found`);
      if (doc.graph.edges.some((e) => e.source === op.node.id || e.target === op.node.id))
        upsertFail(op, `remove_node: node ${op.node.id} still has edges`);
      return {
        ...doc,
        graph: {
          ...doc.graph,
          nodes: doc.graph.nodes.filter((n) => n.id !== op.node.id),
          groups: doc.graph.groups.map((g) =>
            g.children.includes(op.node.id)
              ? { ...g, children: g.children.filter((c) => c !== op.node.id) }
              : g,
          ),
        },
        views: doc.views.map((v) => {
          if (!(op.node.id in v.layout)) return v;
          const layout = { ...v.layout };
          delete layout[op.node.id];
          return { ...v, layout };
        }),
      };
    }
    case "update_node": {
      const node = doc.graph.nodes.find((n) => n.id === op.id);
      if (!node) upsertFail(op, `update_node: id ${op.id} not found`);
      return {
        ...doc,
        graph: {
          ...doc.graph,
          nodes: doc.graph.nodes.map((n) => (n.id === op.id ? applyPatch(n, op.after) : n)),
        },
      };
    }
    case "add_edge": {
      if (doc.graph.edges.some((e) => e.id === op.edge.id))
        upsertFail(op, `add_edge: id ${op.edge.id} already exists`);
      if (!doc.graph.nodes.some((n) => n.id === op.edge.source))
        upsertFail(op, `add_edge: unknown source ${op.edge.source}`);
      if (!doc.graph.nodes.some((n) => n.id === op.edge.target))
        upsertFail(op, `add_edge: unknown target ${op.edge.target}`);
      return {
        ...doc,
        graph: { ...doc.graph, edges: [...doc.graph.edges, clone(op.edge)] },
      };
    }
    case "remove_edge": {
      if (!doc.graph.edges.some((e) => e.id === op.edge.id))
        upsertFail(op, `remove_edge: id ${op.edge.id} not found`);
      return {
        ...doc,
        graph: { ...doc.graph, edges: doc.graph.edges.filter((e) => e.id !== op.edge.id) },
      };
    }
    case "update_edge": {
      const edge = doc.graph.edges.find((e) => e.id === op.id);
      if (!edge) upsertFail(op, `update_edge: id ${op.id} not found`);
      return {
        ...doc,
        graph: {
          ...doc.graph,
          edges: doc.graph.edges.map((e) => (e.id === op.id ? applyPatch(e, op.after) : e)),
        },
      };
    }
    case "add_group": {
      if (doc.graph.groups.some((g) => g.id === op.group.id))
        upsertFail(op, `add_group: id ${op.group.id} already exists`);
      return {
        ...doc,
        graph: { ...doc.graph, groups: [...doc.graph.groups, clone(op.group)] },
      };
    }
    case "remove_group": {
      if (!doc.graph.groups.some((g) => g.id === op.group.id))
        upsertFail(op, `remove_group: id ${op.group.id} not found`);
      return {
        ...doc,
        graph: { ...doc.graph, groups: doc.graph.groups.filter((g) => g.id !== op.group.id) },
      };
    }
    case "update_group": {
      const group = doc.graph.groups.find((g) => g.id === op.id);
      if (!group) upsertFail(op, `update_group: id ${op.id} not found`);
      return {
        ...doc,
        graph: {
          ...doc.graph,
          groups: doc.graph.groups.map((g) => (g.id === op.id ? applyPatch(g, op.after) : g)),
        },
      };
    }
    case "update_meta": {
      return {
        ...doc,
        graph: { ...doc.graph, meta: applyPatch(doc.graph.meta ?? {}, op.after) },
      };
    }
    case "add_view": {
      if (doc.views.some((v) => v.id === op.view.id))
        upsertFail(op, `add_view: id ${op.view.id} already exists`);
      return { ...doc, views: [...doc.views, clone(op.view)] };
    }
    case "remove_view": {
      if (!doc.views.some((v) => v.id === op.view.id))
        upsertFail(op, `remove_view: id ${op.view.id} not found`);
      return { ...doc, views: doc.views.filter((v) => v.id !== op.view.id) };
    }
    case "set_layout": {
      const view = doc.views.find((v) => v.id === op.viewId);
      if (!view) upsertFail(op, `set_layout: unknown view ${op.viewId}`);
      const layout = { ...view.layout };
      if (op.after === null) delete layout[op.nodeId];
      else layout[op.nodeId] = clone(op.after);
      return {
        ...doc,
        views: doc.views.map((v) => (v.id === op.viewId ? { ...v, layout } : v)),
      };
    }
  }
}

/**
 * Applies a diff, returning a new document. The input document is never mutated.
 * Throws DiffConflictError on the first op that cannot apply; no partial state escapes.
 */
export function applyDiff(doc: TopoDoc, diff: GraphDiff): TopoDoc {
  let next = doc;
  for (const op of diff.ops) next = applyOp(next, op);
  return next;
}

/** Computes minimal before/after patches between two versions of an entity. */
export function diffEntity<T extends { id: string }>(
  before: T,
  after: T,
): { before: Patch<T>; after: Patch<T> } | null {
  const beforePatch: Record<string, unknown> = {};
  const afterPatch: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  keys.delete("id");
  for (const key of keys) {
    const b = (before as Record<string, unknown>)[key];
    const a = (after as Record<string, unknown>)[key];
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    beforePatch[key] = b === undefined ? null : clone(b);
    afterPatch[key] = a === undefined ? null : clone(a);
  }
  if (Object.keys(afterPatch).length === 0) return null;
  return { before: beforePatch as Patch<T>, after: afterPatch as Patch<T> };
}

/** Builds an update_node op from two node versions, or null when nothing changed. */
export function makeNodeUpdate(before: Node, after: Node): DiffOp | null {
  const patches = diffEntity(before, after);
  return patches ? { op: "update_node", id: before.id, ...patches } : null;
}

export function makeEdgeUpdate(before: Edge, after: Edge): DiffOp | null {
  const patches = diffEntity(before, after);
  return patches ? { op: "update_edge", id: before.id, ...patches } : null;
}

export function makeGroupUpdate(before: Group, after: Group): DiffOp | null {
  const patches = diffEntity(before, after);
  return patches ? { op: "update_group", id: before.id, ...patches } : null;
}

/** Convenience: builds a set_layout op capturing the previous layout for invertibility. */
export function makeSetLayout(
  view: View,
  nodeId: string,
  after: NodeLayout | null,
): DiffOp {
  const before = view.layout[nodeId] ?? null;
  return { op: "set_layout", viewId: view.id, nodeId, before: clone(before), after: clone(after) };
}
