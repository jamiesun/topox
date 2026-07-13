import { describe, expect, it } from "vitest";
import { applyDiff, emptyDoc, isValid, validateDoc } from "@topox/core";
import type { TopoDoc } from "@topox/core";
import { autoLayoutDiff } from "../src/layout.js";
import { toFlow } from "../src/convert.js";

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
});
