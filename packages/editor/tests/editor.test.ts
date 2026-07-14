import { describe, expect, it } from "vitest";
import { applyDiff, applyRuntimeEvent, emptyDoc, emptyRuntime, isValid, resolveRuntime, validateDoc } from "@talkincode/topox-core";
import type { TopoDoc } from "@talkincode/topox-core";
import { autoLayoutDiff } from "../src/layout.js";
import { snapToAlignment } from "../src/alignment.js";
import { toFlow, groupFlowId, transitiveNodeMembers } from "../src/convert.js";

function chainDoc(): TopoDoc {
  return applyDiff(emptyDoc("g"), {
    ops: [
      { op: "add_node", node: { id: "a", type: "net-cloud", label: "Internet" } },
      { op: "add_node", node: { id: "b", type: "net-router", label: "Router" } },
      { op: "add_node", node: { id: "c", type: "net-server", label: "Server" } },
      { op: "add_edge", edge: { id: "e1", source: "a", target: "b", directed: true } },
      { op: "add_edge", edge: { id: "e2", source: "b", target: "c", directed: true } },
    ],
  });
}

describe("autoLayoutDiff", () => {
  it("emits set_layout ops that apply and order ranks top-down", () => {
    const doc = chainDoc();
    const diff = autoLayoutDiff(doc, "default");
    expect(diff.ops.length).toBe(3);
    const next = applyDiff(doc, diff);
    expect(isValid(validateDoc(next))).toBe(true);
    const layout = next.views[0]!.layout;
    expect(layout["a"]!.y).toBeLessThan(layout["b"]!.y);
    expect(layout["b"]!.y).toBeLessThan(layout["c"]!.y);
    // Layout landed in the view; graph remains geometry-free.
    expect(JSON.stringify(next.graph)).not.toContain('"x"');
  });

  it("is a no-op when positions already match (idempotent)", () => {
    const doc = chainDoc();
    const once = applyDiff(doc, autoLayoutDiff(doc, "default"));
    const again = autoLayoutDiff(once, "default");
    expect(again.ops).toHaveLength(0);
  });

  it("lays out along the requested direction", () => {
    const doc = chainDoc();
    const lr = applyDiff(doc, autoLayoutDiff(doc, "default", { direction: "LR" })).views[0]!.layout;
    expect(lr["a"]!.x).toBeLessThan(lr["b"]!.x);
    expect(lr["b"]!.x).toBeLessThan(lr["c"]!.x);
    const bt = applyDiff(doc, autoLayoutDiff(doc, "default", { direction: "BT" })).views[0]!.layout;
    expect(bt["a"]!.y).toBeGreaterThan(bt["b"]!.y);
    expect(bt["b"]!.y).toBeGreaterThan(bt["c"]!.y);
    const rl = applyDiff(doc, autoLayoutDiff(doc, "default", { direction: "RL" })).views[0]!.layout;
    expect(rl["a"]!.x).toBeGreaterThan(rl["b"]!.x);
    expect(rl["b"]!.x).toBeGreaterThan(rl["c"]!.x);
  });
});

describe("snapToAlignment", () => {
  it("snaps independently to the nearest center and edge within the threshold", () => {
    const snapped = snapToAlignment(
      { id: "moving", x: 407, y: 148, width: 80, height: 40 },
      [{ id: "target", x: 400, y: 100, width: 100, height: 50 }],
    );

    expect(snapped.position).toEqual({ x: 410, y: 150 });
    expect(snapped.guides).toEqual({
      vertical: { position: 450, from: 100, to: 190 },
      horizontal: { position: 150, from: 400, to: 500 },
    });
  });

  it("leaves the candidate unchanged outside the snap threshold", () => {
    const snapped = snapToAlignment(
      { id: "moving", x: 430, y: 160, width: 80, height: 40 },
      [{ id: "target", x: 400, y: 100, width: 100, height: 50 }],
    );

    expect(snapped).toEqual({
      position: { x: 430, y: 160 },
      guides: {},
    });
  });
});

describe("toFlow", () => {
  it("projects layout positions and gives unplaced nodes a fallback grid", () => {
    const doc = applyDiff(chainDoc(), {
      ops: [{ op: "set_layout", viewId: "default", nodeId: "a", before: null, after: { x: 7, y: 8, width: 100, height: 50 } }],
    });
    const { nodes, edges } = toFlow(doc, "default");
    const a = nodes.find((n) => n.id === "a")!;
    expect(a.position).toEqual({ x: 7, y: 8 });
    expect(a.width).toBe(100);
    const b = nodes.find((n) => n.id === "b")!;
    expect(b.position.x).toBeGreaterThanOrEqual(0);
    expect(edges).toHaveLength(2);
    expect(edges[0]).toMatchObject({ source: "a", target: "b" });
  });

  it("anchors edges to the side facing the other endpoint", () => {
    const place = (nodeId: string, x: number, y: number) =>
      ({ op: "set_layout", viewId: "default", nodeId, before: null, after: { x, y, width: 100, height: 50 } }) as const;
    // a → b is mostly horizontal (b to the right); b → c mostly vertical (c below).
    const doc = applyDiff(chainDoc(), {
      ops: [place("a", 0, 0), place("b", 400, 30), place("c", 420, 400)],
    });
    const { edges } = toFlow(doc, "default");
    expect(edges.find((e) => e.id === "e1")).toMatchObject({
      sourceHandle: "right",
      targetHandle: "left",
    });
    expect(edges.find((e) => e.id === "e2")).toMatchObject({
      sourceHandle: "bottom",
      targetHandle: "top",
    });
    // Mirror: a placed right of b flips the horizontal pair.
    const flipped = applyDiff(chainDoc(), {
      ops: [place("a", 800, 0), place("b", 0, 30), place("c", 0, 60)],
    });
    expect(toFlow(flipped, "default").edges.find((e) => e.id === "e1")).toMatchObject({
      sourceHandle: "left",
      targetHandle: "right",
    });
  });

  it("passes node style overrides through to node data", () => {
    const doc = applyDiff(chainDoc(), {
      ops: [
        {
          op: "update_node",
          id: "b",
          before: { style: null },
          after: { style: { fill: "#fee2e2", stroke: "#dc2626", fontWeight: "bold" } },
        },
      ],
    });
    const { nodes } = toFlow(doc, "default");
    expect(nodes.find((node) => node.id === "b")?.data).toMatchObject({
      nodeStyle: { fill: "#fee2e2", stroke: "#dc2626", fontWeight: "bold" },
    });
    expect(nodes.find((node) => node.id === "a")?.data["nodeStyle"]).toBeUndefined();
  });

  it("picks arrowhead markers from directed + arrow direction", () => {
    // e1 (a->b) defaults to forward; e2 (b->c) set to backward and both.
    const backward = applyDiff(chainDoc(), {
      ops: [{ op: "update_edge", id: "e2", before: { arrow: null }, after: { arrow: "backward" } }],
    });
    expect(toFlow(backward, "default").edges.find((e) => e.id === "e1")).toMatchObject({
      markerEnd: "url(#topox-arrow)",
    });
    expect(toFlow(backward, "default").edges.find((e) => e.id === "e1")?.markerStart).toBeUndefined();
    expect(toFlow(backward, "default").edges.find((e) => e.id === "e2")).toMatchObject({
      markerStart: "url(#topox-arrow)",
    });
    expect(toFlow(backward, "default").edges.find((e) => e.id === "e2")?.markerEnd).toBeUndefined();

    const both = applyDiff(chainDoc(), {
      ops: [{ op: "update_edge", id: "e2", before: { arrow: null }, after: { arrow: "both" } }],
    });
    expect(toFlow(both, "default").edges.find((e) => e.id === "e2")).toMatchObject({
      markerStart: "url(#topox-arrow)",
      markerEnd: "url(#topox-arrow)",
    });

    // Undirected edges never get an arrowhead, even with `arrow` set.
    const undirected = applyDiff(chainDoc(), {
      ops: [
        {
          op: "update_edge",
          id: "e1",
          before: { directed: true, arrow: null },
          after: { directed: null, arrow: "both" },
        },
      ],
    });
    const e1 = toFlow(undirected, "default").edges.find((e) => e.id === "e1");
    expect(e1?.markerStart).toBeUndefined();
    expect(e1?.markerEnd).toBeUndefined();
  });

  it("projects search matches, the current result, and dimmed nonmatches", () => {
    const doc = chainDoc();
    const { nodes } = toFlow(doc, "default", undefined, {
      matchedNodeIds: new Set(["b", "c"]),
      currentNodeId: "b",
    });

    expect(nodes.find((node) => node.id === "a")?.data).toMatchObject({
      searchDimmed: true,
      searchMatch: false,
      searchCurrent: false,
    });
    expect(nodes.find((node) => node.id === "b")?.data).toMatchObject({
      searchDimmed: false,
      searchMatch: true,
      searchCurrent: true,
    });
    expect(nodes.find((node) => node.id === "c")?.data).toMatchObject({
      searchDimmed: false,
      searchMatch: true,
      searchCurrent: false,
    });
    expect(JSON.stringify(doc)).not.toContain("searchMatch");
  });

  it("keeps locked nodes selectable while disabling their drag gesture", () => {
    const doc = applyDiff(chainDoc(), {
      ops: [
        {
          op: "update_node",
          id: "b",
          before: {},
          after: { locked: true },
        },
      ],
    });
    const { nodes } = toFlow(doc, "default");
    const locked = nodes.find((node) => node.id === "b")!;
    const unlocked = nodes.find((node) => node.id === "a")!;

    expect(locked).toMatchObject({
      draggable: false,
      data: { locked: true },
    });
    expect(locked.selectable).not.toBe(false);
    expect(unlocked.draggable).toBeUndefined();
    expect(unlocked.data.locked).toBe(false);
  });
});

describe("runtime overlay projection", () => {
  it("carries status/metrics into node data and animates active edges", () => {
    const doc = applyDiff(chainDoc(), {
      ops: [
        {
          op: "update_node",
          id: "b",
          before: {},
          after: { ref: "res-b" },
        },
      ],
    });
    let s = emptyRuntime();
    s = applyRuntimeEvent(s, {
      kind: "node",
      key: "res-b", // via ref
      patch: { status: "error", message: "BGP flap", metrics: { cpu: 93.4 } },
    });
    s = applyRuntimeEvent(s, { kind: "edge", key: "e1", patch: { active: true, metrics: { qps: 120 } } });
    const { nodes, edges } = toFlow(doc, "default", resolveRuntime(doc, s));
    const b = nodes.find((n) => n.id === "b")!;
    expect(b.data).toMatchObject({ status: "error", message: "BGP flap", metrics: { cpu: 93.4 } });
    expect(nodes.find((n) => n.id === "a")!.data.status).toBeUndefined();
    const e1 = edges.find((e) => e.id === "e1")!;
    expect(e1.animated).toBe(true);
    expect(e1.label).toBe("qps 120");
    expect(edges.find((e) => e.id === "e2")!.animated).toBeUndefined();
  });
});

describe("group projection", () => {
  /** a,b in group g1 (nested in g0 with c); d outside. Edges: a->b, b->c, a->d, b->d. */
  function groupedDoc(): TopoDoc {
    return applyDiff(emptyDoc("g"), {
      ops: [
        { op: "add_node", node: { id: "a", type: "t", label: "A" } },
        { op: "add_node", node: { id: "b", type: "t", label: "B" } },
        { op: "add_node", node: { id: "c", type: "t", label: "C" } },
        { op: "add_node", node: { id: "d", type: "t", label: "D" } },
        { op: "add_edge", edge: { id: "ab", source: "a", target: "b", directed: true } },
        { op: "add_edge", edge: { id: "bc", source: "b", target: "c", directed: true } },
        { op: "add_edge", edge: { id: "ad", source: "a", target: "d", directed: true } },
        { op: "add_edge", edge: { id: "bd", source: "b", target: "d", directed: true } },
        { op: "add_group", group: { id: "g1", label: "Inner", children: ["a", "b"] } },
        { op: "add_group", group: { id: "g0", label: "Outer", children: ["g1", "c"] } },
        { op: "set_layout", viewId: "default", nodeId: "a", before: null, after: { x: 0, y: 0 } },
        { op: "set_layout", viewId: "default", nodeId: "b", before: null, after: { x: 200, y: 0 } },
        { op: "set_layout", viewId: "default", nodeId: "c", before: null, after: { x: 100, y: 150 } },
        { op: "set_layout", viewId: "default", nodeId: "d", before: null, after: { x: 500, y: 0 } },
      ],
    });
  }

  it("expanded groups become container nodes wrapping member bounds", () => {
    const { nodes } = toFlow(groupedDoc(), "default");
    const inner = nodes.find((n) => n.id === groupFlowId("g1"))!;
    const outer = nodes.find((n) => n.id === groupFlowId("g0"))!;
    expect(inner.data).toMatchObject({ kind: "container", memberCount: 2 });
    expect(outer.data).toMatchObject({ kind: "container", memberCount: 3 });
    // outer wraps inner
    expect(outer.position.x).toBeLessThan(inner.position.x);
    expect(outer.width!).toBeGreaterThan(inner.width!);
    // containers paint behind nodes, outer behind inner
    expect(outer.zIndex!).toBeLessThan(inner.zIndex!);
    expect(nodes.filter((n) => n.type === "topo")).toHaveLength(4);
  });

  it("collapsing hides members, reroutes boundary edges to the proxy and merges them", () => {
    const doc = applyDiff(groupedDoc(), {
      ops: [{ op: "update_group", id: "g1", before: { collapsed: null }, after: { collapsed: true } }],
    });
    const { nodes, edges } = toFlow(doc, "default");
    expect(nodes.find((n) => n.id === "a")).toBeUndefined();
    expect(nodes.find((n) => n.id === "b")).toBeUndefined();
    const proxy = nodes.find((n) => n.id === groupFlowId("g1"))!;
    expect(proxy.data).toMatchObject({ kind: "proxy", memberCount: 2 });
    // ab internal -> dropped; bc -> proxy->c; ad+bd merge into proxy->d with ×2
    expect(edges.find((e) => e.id === "ab")).toBeUndefined();
    expect(edges.some((e) => e.source === groupFlowId("g1") && e.target === "c")).toBe(true);
    const mergedToD = edges.filter((e) => e.source === groupFlowId("g1") && e.target === "d");
    expect(mergedToD).toHaveLength(1);
    expect(mergedToD[0]!.label).toBe("2×");
  });

  it("disables a collapsed proxy when every hidden member is locked", () => {
    const doc = applyDiff(groupedDoc(), {
      ops: [
        { op: "update_node", id: "a", before: {}, after: { locked: true } },
        { op: "update_node", id: "b", before: {}, after: { locked: true } },
        {
          op: "update_group",
          id: "g1",
          before: { collapsed: null },
          after: { collapsed: true },
        },
      ],
    });
    const proxy = toFlow(doc, "default").nodes.find(
      (node) => node.id === groupFlowId("g1"),
    )!;

    expect(proxy.draggable).toBe(false);
  });

  it("a collapsed parent overrides expanded children (one proxy, no inner artifacts)", () => {
    const doc = applyDiff(groupedDoc(), {
      ops: [{ op: "update_group", id: "g0", before: { collapsed: null }, after: { collapsed: true } }],
    });
    const { nodes, edges } = toFlow(doc, "default");
    // only proxy g0 and node d remain
    expect(nodes.map((n) => n.id).sort()).toEqual([groupFlowId("g0"), "d"].sort());
    const proxy = nodes.find((n) => n.id === groupFlowId("g0"))!;
    expect(proxy.data).toMatchObject({ kind: "proxy", memberCount: 3 });
    // ab, bc fully internal -> gone; ad+bd merge to proxy->d
    const out = edges.filter((e) => e.source === groupFlowId("g0") && e.target === "d");
    expect(out).toHaveLength(1);
    expect(out[0]!.label).toBe("2×");
    expect(edges).toHaveLength(1);
  });

  it("transitiveNodeMembers walks nested groups", () => {
    const doc = groupedDoc();
    expect(transitiveNodeMembers(doc.graph, "g0").sort()).toEqual(["a", "b", "c"]);
    expect(transitiveNodeMembers(doc.graph, "g1").sort()).toEqual(["a", "b"]);
  });
});

describe("node icons", () => {
  it("resolves explicit icon name first, then falls back to node type", async () => {
    const { registerNodeIcon, resolveNodeIcon, listNodeIcons, hasNodeIcon } = await import("../src/icons.js");
    // built-in vocabulary is registered on import (network + app + device)
    expect(listNodeIcons()).toContain("net-router");
    expect(listNodeIcons()).toContain("app-backend");
    expect(listNodeIcons()).toContain("device-sensor");
    expect(listNodeIcons().length).toBeGreaterThanOrEqual(30);
    // type fallback
    expect(resolveNodeIcon(undefined, "net-router")).toBeDefined();
    // explicit name beats type
    const routerIcon = resolveNodeIcon(undefined, "net-router");
    const cloudIcon = resolveNodeIcon("net-cloud", "net-router");
    expect(cloudIcon).toBeDefined();
    expect(cloudIcon).not.toBe(routerIcon);
    // unknown explicit name falls back to type
    expect(resolveNodeIcon("no-such-icon", "net-router")).toBe(routerIcon);
    // unknown everything -> undefined (node renders without an icon)
    expect(resolveNodeIcon("no-such-icon", "no-such-type")).toBeUndefined();
    // hosts can extend the vocabulary
    registerNodeIcon("custom-test", (p) => routerIcon!(p));
    expect(resolveNodeIcon("custom-test", "whatever")).toBeDefined();
    // hasNodeIcon distinguishes registered names from literal glyphs (emoji)
    expect(hasNodeIcon("net-router")).toBe(true);
    expect(hasNodeIcon("\u{1F525}")).toBe(false);
  });
});
