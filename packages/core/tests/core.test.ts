import { describe, expect, it } from "vitest";
import {
  applyDiff,
  DiffConflictError,
  emptyDoc,
  History,
  invertDiff,
  makeNodeUpdate,
  makeSetLayout,
  toInventory,
  inventoryToCsv,
  searchNodes,
  validateDoc,
  validateGraph,
  isValid,
} from "../src/index.js";
import type { GraphDiff, Node, TopoDoc } from "../src/index.js";

function fixtureDoc(): TopoDoc {
  const doc = emptyDoc("g1", "Test");
  return applyDiff(doc, {
    ops: [
      { op: "add_node", node: { id: "a", type: "net-router", label: "Router A", ref: "r2s:a" } },
      { op: "add_node", node: { id: "b", type: "net-server", label: "Server B", tags: ["prod"] } },
      { op: "add_node", node: { id: "c", type: "net-cloud", label: "Internet" } },
      { op: "add_edge", edge: { id: "e1", source: "c", target: "a", directed: true } },
      { op: "add_edge", edge: { id: "e2", source: "a", target: "b", directed: true, label: "wan" } },
      { op: "add_group", group: { id: "grp1", label: "Site 1", children: ["a", "b"] } },
      { op: "set_layout", viewId: "default", nodeId: "a", before: null, after: { x: 10, y: 20 } },
    ],
  });
}

describe("applyDiff", () => {
  it("applies ops and never mutates the input", () => {
    const original = emptyDoc("g1");
    const originalJson = JSON.stringify(original);
    const next = applyDiff(original, {
      ops: [{ op: "add_node", node: { id: "a", type: "t", label: "A" } }],
    });
    expect(JSON.stringify(original)).toBe(originalJson);
    expect(next.graph.nodes).toHaveLength(1);
  });

  it("rejects duplicate node ids", () => {
    const doc = fixtureDoc();
    expect(() =>
      applyDiff(doc, { ops: [{ op: "add_node", node: { id: "a", type: "t", label: "dup" } }] }),
    ).toThrow(DiffConflictError);
  });

  it("rejects edges to unknown nodes", () => {
    const doc = fixtureDoc();
    expect(() =>
      applyDiff(doc, { ops: [{ op: "add_edge", edge: { id: "ex", source: "a", target: "ghost" } }] }),
    ).toThrow(DiffConflictError);
  });

  it("refuses to remove a node that still has edges", () => {
    const doc = fixtureDoc();
    expect(() =>
      applyDiff(doc, {
        ops: [{ op: "remove_node", node: doc.graph.nodes.find((n) => n.id === "a")! }],
      }),
    ).toThrow(DiffConflictError);
  });

  it("removing a node cleans groups and layouts", () => {
    const doc = fixtureDoc();
    const next = applyDiff(doc, {
      ops: [
        { op: "remove_edge", edge: doc.graph.edges.find((e) => e.id === "e1")! },
        { op: "remove_edge", edge: doc.graph.edges.find((e) => e.id === "e2")! },
        { op: "remove_node", node: doc.graph.nodes.find((n) => n.id === "a")! },
      ],
    });
    expect(next.graph.groups[0]!.children).toEqual(["b"]);
    expect(next.views[0]!.layout["a"]).toBeUndefined();
  });

  it("update_node patches fields and null deletes them", () => {
    const doc = fixtureDoc();
    const next = applyDiff(doc, {
      ops: [{ op: "update_node", id: "a", before: { label: "Router A", ref: "r2s:a" }, after: { label: "R-A", ref: null } }],
    });
    const node = next.graph.nodes.find((n) => n.id === "a")!;
    expect(node.label).toBe("R-A");
    expect("ref" in node).toBe(false);
  });
});

describe("invertDiff", () => {
  it("round-trips any diff back to the exact original document", () => {
    const doc = fixtureDoc();
    const diff: GraphDiff = {
      summary: "edit batch",
      ops: [
        { op: "update_node", id: "b", before: { label: "Server B" }, after: { label: "SRV-B" } },
        { op: "add_node", node: { id: "d", type: "net-cpe", label: "CPE D" } },
        { op: "add_edge", edge: { id: "e3", source: "b", target: "d" } },
        { op: "set_layout", viewId: "default", nodeId: "d", before: null, after: { x: 5, y: 5 } },
        { op: "update_meta", before: { name: "Test" }, after: { name: "Renamed" } },
      ],
    };
    const changed = applyDiff(doc, diff);
    const restored = applyDiff(changed, invertDiff(diff));
    expect(JSON.stringify(restored)).toBe(JSON.stringify(doc));
  });
});

describe("makeNodeUpdate / makeSetLayout", () => {
  it("computes minimal invertible patches", () => {
    const before: Node = { id: "a", type: "t", label: "A", tags: ["x"] };
    const after: Node = { id: "a", type: "t", label: "A2" };
    const op = makeNodeUpdate(before, after)!;
    expect(op).toEqual({
      op: "update_node",
      id: "a",
      before: { label: "A", tags: ["x"] },
      after: { label: "A2", tags: null },
    });
    expect(makeNodeUpdate(before, { ...before })).toBeNull();
  });

  it("captures previous layout for undo", () => {
    const doc = fixtureDoc();
    const op = makeSetLayout(doc.views[0]!, "a", { x: 99, y: 99 });
    expect(op).toMatchObject({ before: { x: 10, y: 20 }, after: { x: 99, y: 99 } });
  });
});

describe("History", () => {
  it("undo/redo walk the diff log", () => {
    const history = new History(fixtureDoc());
    history.apply({ summary: "rename", ops: [{ op: "update_node", id: "a", before: { label: "Router A" }, after: { label: "R1" } }] });
    history.apply({ summary: "move", ops: [{ op: "set_layout", viewId: "default", nodeId: "a", before: { x: 10, y: 20 }, after: { x: 0, y: 0 } }] });

    expect(history.doc.graph.nodes.find((n) => n.id === "a")!.label).toBe("R1");
    history.undo();
    expect(history.doc.views[0]!.layout["a"]).toEqual({ x: 10, y: 20 });
    history.undo();
    expect(history.doc.graph.nodes.find((n) => n.id === "a")!.label).toBe("Router A");
    expect(history.canUndo).toBe(false);
    history.redo();
    history.redo();
    expect(history.doc.views[0]!.layout["a"]).toEqual({ x: 0, y: 0 });
    expect(history.canRedo).toBe(false);
  });

  it("applying after undo discards the redo tail", () => {
    const history = new History(fixtureDoc());
    history.apply({ ops: [{ op: "add_node", node: { id: "x", type: "t", label: "X" } }] });
    history.undo();
    history.apply({ ops: [{ op: "add_node", node: { id: "y", type: "t", label: "Y" } }] });
    expect(history.canRedo).toBe(false);
    expect(history.doc.graph.nodes.some((n) => n.id === "x")).toBe(false);
    expect(history.doc.graph.nodes.some((n) => n.id === "y")).toBe(true);
  });
});

describe("validate", () => {
  it("accepts the fixture", () => {
    expect(isValid(validateDoc(fixtureDoc()))).toBe(true);
  });

  it("catches dangling edges, duplicate ids and group cycles", () => {
    const doc = fixtureDoc();
    const bad = structuredClone(doc.graph);
    bad.edges.push({ id: "bad", source: "a", target: "ghost" });
    bad.nodes.push({ id: "a", type: "t", label: "dup" });
    bad.groups.push({ id: "g2", label: "G2", children: ["grp1"] });
    bad.groups = bad.groups.map((g) =>
      g.id === "grp1" ? { ...g, children: [...g.children, "g2"] } : g,
    );
    const codes = validateGraph(bad).map((i) => i.code);
    expect(codes).toContain("edge_target");
    expect(codes).toContain("dup_node");
    expect(codes).toContain("group_cycle");
  });

  it("warns about orphan layouts", () => {
    const doc = fixtureDoc();
    const withOrphan: TopoDoc = {
      ...doc,
      views: [{ ...doc.views[0]!, layout: { ...doc.views[0]!.layout, ghost: { x: 0, y: 0 } } }],
    };
    const issues = validateDoc(withOrphan);
    expect(issues.some((i) => i.code === "layout_orphan" && i.severity === "warning")).toBe(true);
  });
});

describe("inventory projection", () => {
  it("derives the customer-facing list from the same graph", () => {
    const rows = toInventory(fixtureDoc().graph);
    expect(rows).toHaveLength(3);
    const routerA = rows.find((r) => r.id === "a")!;
    expect(routerA).toMatchObject({ type: "net-router", ref: "r2s:a", group: "Site 1", connections: 2 });
    const csv = inventoryToCsv(rows);
    expect(csv.split("\n")).toHaveLength(4);
    expect(csv).toContain("net-router");
  });

  it("searches across label, tags, type and ref", () => {
    const graph = fixtureDoc().graph;
    expect(searchNodes(graph, "prod").map((n) => n.id)).toEqual(["b"]);
    expect(searchNodes(graph, "r2s:").map((n) => n.id)).toEqual(["a"]);
    expect(searchNodes(graph, "net-cloud").map((n) => n.id)).toEqual(["c"]);
    expect(searchNodes(graph, "")).toHaveLength(3);
  });
});
