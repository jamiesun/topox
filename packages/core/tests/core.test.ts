import { describe, expect, it } from "vitest";
import {
  applyDiff,
  DiffConflictError,
  emptyDoc,
  History,
  invertDiff,
  makeNodeUpdate,
  makeDuplicateNodes,
  makeRemoveOps,
  makeSetLayout,
  toInventory,
  inventoryToCsv,
  searchNodes,
  validateDoc,
  validateGraph,
  isValid,
  emptyRuntime,
  applyRuntimeEvent,
  parseRuntimeSnapshot,
  resolveRuntime,
  RuntimeTimeline,
  serializeRuntimeSnapshot,
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

  it("refuses to remove a node still referenced by a group or a view layout", () => {
    const doc = fixtureDoc();
    const nodeA = doc.graph.nodes.find((n) => n.id === "a")!;
    const dropEdges = doc.graph.edges
      .filter((e) => e.source === "a" || e.target === "a")
      .map((edge) => ({ op: "remove_edge", edge }) as const);
    // Still a member of grp1.
    expect(() =>
      applyDiff(doc, { ops: [...dropEdges, { op: "remove_node", node: nodeA }] }),
    ).toThrow(/group member/);
    // Membership cleaned but layout still present.
    expect(() =>
      applyDiff(doc, {
        ops: [
          ...dropEdges,
          { op: "update_group", id: "grp1", before: { children: ["a", "b"] }, after: { children: ["b"] } },
          { op: "remove_node", node: nodeA },
        ],
      }),
    ).toThrow(/view layout/);
  });

  it("rejects update_edge that would dangle an endpoint", () => {
    const doc = fixtureDoc();
    expect(() =>
      applyDiff(doc, {
        ops: [{ op: "update_edge", id: "e1", before: { target: "a" }, after: { target: "ghost" } }],
      }),
    ).toThrow(DiffConflictError);
  });

  it("rejects groups referencing unknown children", () => {
    const doc = fixtureDoc();
    expect(() =>
      applyDiff(doc, {
        ops: [{ op: "add_group", group: { id: "gX", label: "X", children: ["ghost"] } }],
      }),
    ).toThrow(DiffConflictError);
    expect(() =>
      applyDiff(doc, {
        ops: [{ op: "update_group", id: "grp1", before: { children: ["a", "b"] }, after: { children: ["a", "ghost"] } }],
      }),
    ).toThrow(DiffConflictError);
  });

  it("rejects ids shared between nodes and groups", () => {
    const doc = fixtureDoc();
    expect(() =>
      applyDiff(doc, { ops: [{ op: "add_node", node: { id: "grp1", type: "t", label: "clash" } }] }),
    ).toThrow(DiffConflictError);
    expect(() =>
      applyDiff(doc, { ops: [{ op: "add_group", group: { id: "a", label: "clash", children: [] } }] }),
    ).toThrow(DiffConflictError);
  });

  it("refuses to remove a group still referenced by a parent group", () => {
    const doc = applyDiff(fixtureDoc(), {
      ops: [{ op: "add_group", group: { id: "outer", label: "Outer", children: ["grp1"] } }],
    });
    const grp1 = doc.graph.groups.find((g) => g.id === "grp1")!;
    expect(() =>
      applyDiff(doc, { ops: [{ op: "remove_group", group: grp1 }] }),
    ).toThrow(/parent group/);
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

describe("makeRemoveOps", () => {
  /** Order-insensitive doc equality: undo re-appends entities at the end. */
  function normalize(doc: TopoDoc): TopoDoc {
    const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);
    return {
      ...doc,
      graph: {
        ...doc.graph,
        nodes: [...doc.graph.nodes].sort(byId),
        edges: [...doc.graph.edges].sort(byId),
        groups: [...doc.graph.groups].sort(byId),
      },
    };
  }

  it("removes a node with its edges, memberships and layouts, and undo restores everything", () => {
    const doc = fixtureDoc();
    const diff: GraphDiff = { summary: "delete a", ops: makeRemoveOps(doc, { nodeIds: ["a"] }) };
    const next = applyDiff(doc, diff);
    expect(next.graph.nodes.map((n) => n.id)).toEqual(["b", "c"]);
    expect(next.graph.edges).toHaveLength(0);
    expect(next.graph.groups[0]!.children).toEqual(["b"]);
    expect(next.views[0]!.layout["a"]).toBeUndefined();
    expect(isValid(validateDoc(next))).toBe(true);

    const restored = applyDiff(next, invertDiff(diff));
    expect(JSON.stringify(normalize(restored))).toBe(JSON.stringify(normalize(doc)));
    expect(restored.views[0]!.layout["a"]).toEqual({ x: 10, y: 20 });
  });

  it("dissolves a group while keeping its members", () => {
    const doc = fixtureDoc();
    const diff: GraphDiff = { ops: makeRemoveOps(doc, { groupIds: ["grp1"] }) };
    const next = applyDiff(doc, diff);
    expect(next.graph.groups).toHaveLength(0);
    expect(next.graph.nodes).toHaveLength(3);
    expect(isValid(validateDoc(next))).toBe(true);
    const restored = applyDiff(next, invertDiff(diff));
    expect(JSON.stringify(normalize(restored))).toBe(JSON.stringify(normalize(doc)));
  });

  it("handles nested groups plus their contents in one selection", () => {
    const doc = applyDiff(fixtureDoc(), {
      ops: [{ op: "add_group", group: { id: "outer", label: "Outer", children: ["grp1", "c"] } }],
    });
    const diff: GraphDiff = {
      ops: makeRemoveOps(doc, { nodeIds: ["a", "b"], groupIds: ["grp1", "outer"] }),
    };
    const next = applyDiff(doc, diff);
    expect(next.graph.nodes.map((n) => n.id)).toEqual(["c"]);
    expect(next.graph.groups).toHaveLength(0);
    expect(next.graph.edges).toHaveLength(0);
    expect(isValid(validateDoc(next))).toBe(true);
    const restored = applyDiff(next, invertDiff(diff));
    expect(JSON.stringify(normalize(restored))).toBe(JSON.stringify(normalize(doc)));
  });

  it("removes a child group referenced by a surviving parent", () => {
    const doc = applyDiff(fixtureDoc(), {
      ops: [{ op: "add_group", group: { id: "outer", label: "Outer", children: ["grp1", "c"] } }],
    });
    const diff: GraphDiff = { ops: makeRemoveOps(doc, { groupIds: ["grp1"] }) };
    const next = applyDiff(doc, diff);
    expect(next.graph.groups.map((g) => g.id)).toEqual(["outer"]);
    expect(next.graph.groups[0]!.children).toEqual(["c"]);
    expect(isValid(validateDoc(next))).toBe(true);
    const restored = applyDiff(next, invertDiff(diff));
    expect(JSON.stringify(normalize(restored))).toBe(JSON.stringify(normalize(doc)));
  });

  it("ignores unknown ids", () => {
    const doc = fixtureDoc();
    expect(makeRemoveOps(doc, { nodeIds: ["ghost"], edgeIds: ["ex"], groupIds: ["gx"] })).toEqual([]);
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

describe("makeDuplicateNodes", () => {
  it("deep-copies nodes with unique ids, offset layouts, and group membership in one diff", () => {
    const doc = applyDiff(fixtureDoc(), {
      ops: [
        {
          op: "update_node",
          id: "b",
          before: { tags: ["prod"] },
          after: { tags: ["prod", "api"], attrs: { nested: { retries: 3 } } },
        },
      ],
    });
    const result = makeDuplicateNodes(doc, "default", ["a", "b", "a"], {
      offset: { x: 24, y: 24 },
      positions: { b: { x: 50, y: 60, width: 180, height: 70 } },
    });

    expect(result.nodeIds).toEqual(["a-copy", "b-copy"]);
    expect(result.diff).toMatchObject({
      origin: "user",
      summary: "duplicate 2 nodes",
    });
    const added = result.diff.ops
      .filter((op) => op.op === "add_node")
      .map((op) => op.node);
    expect(added).toEqual([
      { ...doc.graph.nodes.find((node) => node.id === "a")!, id: "a-copy" },
      { ...doc.graph.nodes.find((node) => node.id === "b")!, id: "b-copy" },
    ]);
    expect(added[1]!.attrs).not.toBe(doc.graph.nodes.find((node) => node.id === "b")!.attrs);
    expect(result.diff.ops).toContainEqual({
      op: "set_layout",
      viewId: "default",
      nodeId: "a-copy",
      before: null,
      after: { x: 34, y: 44 },
    });
    expect(result.diff.ops).toContainEqual({
      op: "set_layout",
      viewId: "default",
      nodeId: "b-copy",
      before: null,
      after: { x: 74, y: 84, width: 180, height: 70 },
    });

    const history = new History(doc);
    const changed = history.apply(result.diff);
    expect(changed.graph.groups[0]?.children).toEqual(["a", "a-copy", "b", "b-copy"]);
    expect(history.undo()).toEqual(doc);

    const next = makeDuplicateNodes(changed, "default", ["a"]);
    expect(next.nodeIds).toEqual(["a-copy-2"]);
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

describe("runtime overlay", () => {
  it("applies node/edge events immutably with per-key metric merge", () => {
    const s0 = emptyRuntime();
    const s1 = applyRuntimeEvent(s0, {
      kind: "node",
      key: "r2s:a",
      patch: { status: "running", metrics: { cpu: 10, mem: 40 } },
      ts: 1000,
    });
    const s2 = applyRuntimeEvent(s1, {
      kind: "node",
      key: "r2s:a",
      patch: { metrics: { cpu: 55 } },
      ts: 2000,
    });
    expect(s0.nodes).toEqual({});
    expect(s1.nodes["r2s:a"]).toMatchObject({ status: "running", metrics: { cpu: 10, mem: 40 } });
    expect(s2.nodes["r2s:a"]).toMatchObject({
      status: "running",
      metrics: { cpu: 55, mem: 40 },
      updatedAt: 2000,
    });
    expect(s2.ts).toBe(2000);
  });

  it("removes entries with null patches and replaces on snapshot", () => {
    let s = applyRuntimeEvent(emptyRuntime(), {
      kind: "edge",
      key: "e1",
      patch: { active: true, metrics: { qps: 120 } },
      ts: 1,
    });
    s = applyRuntimeEvent(s, { kind: "edge", key: "e1", patch: null, ts: 2 });
    expect(s.edges).toEqual({});
    s = applyRuntimeEvent(s, {
      kind: "snapshot",
      state: { nodes: { x: { status: "error" } }, edges: {} },
      ts: 3,
    });
    expect(s.nodes["x"]?.status).toBe("error");
    expect(s.ts).toBe(3);
  });

  it("resolves by Node.ref first, then node id; edges by id", () => {
    const doc = fixtureDoc();
    let s = emptyRuntime();
    // "a" has ref "r2s:a" — producer keys by ref. "b" has no ref — keyed by id.
    s = applyRuntimeEvent(s, { kind: "node", key: "r2s:a", patch: { status: "running" } });
    s = applyRuntimeEvent(s, { kind: "node", key: "b", patch: { status: "error" } });
    s = applyRuntimeEvent(s, { kind: "node", key: "ghost", patch: { status: "offline" } });
    s = applyRuntimeEvent(s, { kind: "edge", key: "e2", patch: { active: true } });
    const resolved = resolveRuntime(doc, s);
    expect(resolved.nodes.get("a")?.status).toBe("running");
    expect(resolved.nodes.get("b")?.status).toBe("error");
    expect(resolved.nodes.has("c")).toBe(false);
    expect(resolved.edges.get("e2")?.active).toBe(true);
    expect(resolved.edges.has("e1")).toBe(false);
  });
});

describe("runtime timeline", () => {
  const nodeEv = (key: string, cpu: number, ts: number): Parameters<RuntimeTimeline["record"]>[0] => ({
    kind: "node",
    key,
    patch: { status: "running", metrics: { cpu } },
    ts,
  });

  it("replays state at any timestamp (inclusive, between, before, after)", () => {
    const tl = new RuntimeTimeline();
    tl.record(nodeEv("a", 10, 1000));
    tl.record(nodeEv("a", 20, 2000));
    tl.record(nodeEv("b", 5, 3000));
    expect(tl.range).toEqual({ start: 1000, end: 3000 });
    expect(tl.stateAt(999).nodes).toEqual({});
    expect(tl.stateAt(1000).nodes["a"]?.metrics?.["cpu"]).toBe(10);
    expect(tl.stateAt(2500).nodes["a"]?.metrics?.["cpu"]).toBe(20);
    expect(tl.stateAt(2500).nodes["b"]).toBeUndefined();
    const end = tl.stateAt(99999);
    expect(end.nodes["a"]?.metrics?.["cpu"]).toBe(20);
    expect(end.nodes["b"]?.metrics?.["cpu"]).toBe(5);
  });

  it("checkpointed seeks equal a full linear replay", () => {
    const tl = new RuntimeTimeline({ checkpointInterval: 3 });
    let linear = emptyRuntime();
    for (let i = 0; i < 20; i++) {
      const ev = nodeEv("n", i, 1000 + i * 100);
      tl.record(ev);
      linear = applyRuntimeEvent(linear, ev);
      expect(tl.stateAt(1000 + i * 100)).toEqual(linear);
    }
    // mid-window seek
    expect(tl.stateAt(1750).nodes["n"]?.metrics?.["cpu"]).toBe(7);
  });

  it("trims old events into the base state without corrupting replay", () => {
    const tl = new RuntimeTimeline({ checkpointInterval: 2, maxEvents: 8 });
    for (let i = 0; i < 20; i++) tl.record(nodeEv("n", i, 1000 + i * 10));
    expect(tl.length).toBeLessThanOrEqual(8);
    // before the retained window → folded base still carries history
    const base = tl.stateAt(tl.range!.start - 1);
    expect(typeof base.nodes["n"]?.metrics?.["cpu"]).toBe("number");
    // latest is intact
    expect(tl.stateAt(9999).nodes["n"]?.metrics?.["cpu"]).toBe(19);
    // a seek inside the window is exact
    const inside = tl.range!.start;
    const cpuInside = tl.stateAt(inside).nodes["n"]?.metrics?.["cpu"];
    expect(cpuInside).toBe((inside - 1000) / 10);
  });

  it("pins wall-clock ts on unstamped events and keeps order monotonic", () => {
    const tl = new RuntimeTimeline();
    tl.record({ kind: "node", key: "x", patch: { status: "running" } }, 5000);
    tl.record(nodeEv("x", 1, 4000)); // out of order → clamped to 5000
    expect(tl.range).toEqual({ start: 5000, end: 5000 });
    expect(tl.stateAt(5000).nodes["x"]?.metrics?.["cpu"]).toBe(1);
  });

  it("keeps a bounded, merged runtime history for a node", () => {
    const tl = new RuntimeTimeline({ checkpointInterval: 2, maxEvents: 4 });
    tl.record({
      kind: "node",
      key: "a",
      patch: { status: "running", metrics: { cpu: 10 } },
      ts: 1000,
    });
    tl.record({
      kind: "node",
      key: "a",
      patch: { status: "error", metrics: { latency: 20 } },
      ts: 2000,
    });
    tl.record(nodeEv("b", 1, 3000));
    tl.record(nodeEv("a", 40, 4000));

    expect(tl.nodeHistory(["a"])).toEqual([
      {
        ts: 1000,
        key: "a",
        runtime: { status: "running", metrics: { cpu: 10 }, updatedAt: 1000 },
      },
      {
        ts: 2000,
        key: "a",
        runtime: { status: "error", metrics: { cpu: 10, latency: 20 }, updatedAt: 2000 },
      },
      {
        ts: 4000,
        key: "a",
        runtime: { status: "running", metrics: { cpu: 40, latency: 20 }, updatedAt: 4000 },
      },
    ]);

    tl.record(nodeEv("a", 50, 5000));
    expect(tl.nodeHistory(["a"])).toEqual([
      {
        ts: 4000,
        key: "a",
        runtime: { status: "running", metrics: { cpu: 40, latency: 20 }, updatedAt: 4000 },
      },
      {
        ts: 5000,
        key: "a",
        runtime: { status: "running", metrics: { cpu: 50, latency: 20 }, updatedAt: 5000 },
      },
    ]);
  });

  it("records a snapshot when it clears a traced node", () => {
    const tl = new RuntimeTimeline();
    tl.record({
      kind: "node",
      key: "a",
      patch: { status: "running", metrics: { cpu: 10 } },
      ts: 1000,
    });
    tl.record({ kind: "snapshot", state: emptyRuntime(), ts: 2000 });

    expect(tl.nodeHistory(["a"])).toEqual([
      {
        ts: 1000,
        key: "a",
        runtime: { status: "running", metrics: { cpu: 10 }, updatedAt: 1000 },
      },
      { ts: 2000, key: "a", runtime: null },
    ]);
  });
});

describe("runtime snapshots", () => {
  const nodeEvent = (cpu: number, ts: number) => ({
    kind: "node" as const,
    key: "node-a",
    patch: { status: "running" as const, metrics: { cpu } },
    ts,
  });

  it("round-trips a trimmed timeline without losing its retained base state", () => {
    const timeline = new RuntimeTimeline({ checkpointInterval: 2, maxEvents: 4 });
    for (let i = 1; i <= 6; i++) timeline.record(nodeEvent(i * 10, i * 1000));
    const expected = timeline.stateAt(Number.POSITIVE_INFINITY);

    const snapshot = timeline.toSnapshot(7000);
    expect(snapshot).toMatchObject({
      format: "topox-runtime-snapshot",
      version: 1,
      capturedAt: 7000,
      range: { start: 3000, end: 6000 },
    });
    expect(snapshot.events[0]).toMatchObject({ kind: "snapshot", ts: 3000 });

    const parsed = parseRuntimeSnapshot(serializeRuntimeSnapshot(snapshot));
    const restored = new RuntimeTimeline();
    restored.loadSnapshot(parsed);

    expect(restored.range).toEqual(snapshot.range);
    expect(restored.eventTimestamps).toEqual([3000, 4000, 5000, 6000]);
    expect(restored.stateAt(snapshot.range!.end)).toEqual(expected);
  });

  it("rejects unsupported versions and malformed event payloads", () => {
    const timeline = new RuntimeTimeline();
    timeline.record(nodeEvent(10, 1000));
    const snapshot = timeline.toSnapshot(2000);

    expect(() =>
      parseRuntimeSnapshot(JSON.stringify({ ...snapshot, version: 2 })),
    ).toThrow(/unsupported runtime snapshot version: 2/);
    expect(() =>
      parseRuntimeSnapshot(
        JSON.stringify({
          ...snapshot,
          events: [{ kind: "node", key: "node-a", patch: { metrics: { cpu: true } }, ts: 1000 }],
        }),
      ),
    ).toThrow(/events\[0\].*metrics\.cpu/);
    expect(() =>
      parseRuntimeSnapshot(JSON.stringify({ ...snapshot, range: { start: 999, end: 1000 } })),
    ).toThrow(/range does not match event timestamps/);
  });

  it("validates a replacement before clearing the current timeline", () => {
    const timeline = new RuntimeTimeline();
    timeline.record(nodeEvent(10, 1000));
    const before = timeline.stateAt(1000);
    const invalid = {
      ...timeline.toSnapshot(2000),
      version: 2,
    } as unknown as Parameters<RuntimeTimeline["loadSnapshot"]>[0];

    expect(() => timeline.loadSnapshot(invalid)).toThrow(/unsupported runtime snapshot version: 2/);
    expect(timeline.range).toEqual({ start: 1000, end: 1000 });
    expect(timeline.stateAt(1000)).toEqual(before);
  });
});
