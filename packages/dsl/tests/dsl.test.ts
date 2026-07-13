import { describe, expect, it } from "vitest";
import { applyDiff, emptyDoc, invertDiff, isValid, validateDoc } from "@topox/core";
import type { TopoDoc } from "@topox/core";
import { compileDsl, docToDsl, tokenize } from "../src/index.js";

function base(): TopoDoc {
  return applyDiff(emptyDoc("g"), {
    ops: [
      { op: "add_node", node: { id: "r1", type: "net-router", label: "Router", ref: "ros:hq" } },
      { op: "add_node", node: { id: "db", type: "net-database", label: "PostgreSQL" } },
      { op: "add_edge", edge: { id: "e1", source: "r1", target: "db", directed: true } },
    ],
  });
}

describe("tokenize", () => {
  it("handles quotes, escapes, key=value with quoted values and comments", () => {
    expect(tokenize('node a "Hello World" type=x note="a #1 \\"q\\"" # trailing')).toEqual([
      { text: "node", quoted: false },
      { text: "a", quoted: false },
      { text: "Hello World", quoted: true },
      { text: "type=x", quoted: false },
      { text: 'note=a #1 "q"', quoted: false },
    ]);
  });
});

describe("compileDsl", () => {
  it("the canonical example: three agents through a router to a database", () => {
    const doc = emptyDoc("g");
    const { diff, errors } = compileDsl(
      `# 创建三个Agent，通过Router连接数据库
node agent-1 "Agent 1" type=agent
node agent-2 "Agent 2" type=agent
node agent-3 "Agent 3" type=agent
node router "Router" type=net-router
node db "Database" type=net-database
edge agent-1 -> router
edge agent-2 -> router
edge agent-3 -> router
edge router -> db "queries"`,
      doc,
    );
    expect(errors).toEqual([]);
    expect(diff.ops).toHaveLength(9);
    const next = applyDiff(doc, diff);
    expect(isValid(validateDoc(next))).toBe(true);
    expect(next.graph.nodes).toHaveLength(5);
    expect(next.graph.edges).toHaveLength(4);
    expect(next.graph.edges[3]).toMatchObject({ source: "router", target: "db", label: "queries", directed: true });
    // and the whole proposal is undoable
    const undone = applyDiff(next, invertDiff(diff));
    expect(JSON.stringify(undone)).toBe(JSON.stringify(doc));
  });

  it("node statements upsert existing nodes without losing fields", () => {
    const doc = base();
    const { diff, errors } = compileDsl(`node r1 "Edge Router" vendor=mikrotik`, doc);
    expect(errors).toEqual([]);
    const next = applyDiff(doc, diff);
    const r1 = next.graph.nodes.find((n) => n.id === "r1")!;
    expect(r1).toMatchObject({
      label: "Edge Router",
      type: "net-router",
      ref: "ros:hq",
      attrs: { vendor: "mikrotik" },
    });
  });

  it("set updates fields and attrs; null deletes", () => {
    const doc = base();
    const { diff, errors } = compileDsl(
      `set node r1 ref=null cpu=88 tags=core,hq
set edge e1 label=sql weight=3`,
      doc,
    );
    expect(errors).toEqual([]);
    const next = applyDiff(doc, diff);
    const r1 = next.graph.nodes.find((n) => n.id === "r1")!;
    expect(r1.ref).toBeUndefined();
    expect(r1.attrs).toEqual({ cpu: 88 });
    expect(r1.tags).toEqual(["core", "hq"]);
    expect(next.graph.edges[0]).toMatchObject({ label: "sql", weight: 3 });
  });

  it("remove node cascades its edges", () => {
    const doc = base();
    const { diff, errors } = compileDsl("remove node db", doc);
    expect(errors).toEqual([]);
    const next = applyDiff(doc, diff);
    expect(next.graph.nodes.map((n) => n.id)).toEqual(["r1"]);
    expect(next.graph.edges).toHaveLength(0);
  });

  it("bad lines are reported and skipped, good lines still compile", () => {
    const doc = base();
    const { diff, errors } = compileDsl(
      `node ok "Fine"
edge ok -> ghost
teleport x y
edge r1 -- ok`,
      doc,
    );
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ line: 2 });
    expect(errors[1]).toMatchObject({ line: 3, message: expect.stringContaining("unknown statement") });
    const next = applyDiff(doc, diff);
    expect(next.graph.nodes).toHaveLength(3);
    expect(next.graph.edges).toHaveLength(2);
    expect(next.graph.edges[1]!.directed).toBeUndefined();
  });

  it("groups create and update", () => {
    const doc = base();
    const { diff, errors } = compileDsl(`group site "Site A" children=r1,db`, doc);
    expect(errors).toEqual([]);
    const next = applyDiff(doc, diff);
    expect(next.graph.groups[0]).toMatchObject({ id: "site", label: "Site A", children: ["r1", "db"] });
  });

  it("generated edge ids never collide", () => {
    const doc = base();
    const { diff, errors } = compileDsl(
      `edge r1 -> db "a"
edge r1 -> db "b"`,
      doc,
    );
    expect(errors).toEqual([]);
    const next = applyDiff(doc, diff);
    const ids = next.graph.edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("docToDsl round-trip", () => {
  it("serializes and recompiles into an equivalent graph", () => {
    const doc = applyDiff(base(), {
      ops: [
        { op: "update_node", id: "db", before: {}, after: { tags: ["prod"], attrs: { size: "xl", replicas: 2 } } },
        { op: "add_group", group: { id: "g1", label: "Core Site", children: ["r1", "db"] } },
      ],
    });
    const dsl = docToDsl(doc);
    const { diff, errors } = compileDsl(dsl, emptyDoc("fresh"));
    expect(errors).toEqual([]);
    const rebuilt = applyDiff(emptyDoc("fresh"), diff);
    expect(rebuilt.graph.nodes).toEqual(doc.graph.nodes);
    expect(rebuilt.graph.edges).toEqual(doc.graph.edges);
    expect(rebuilt.graph.groups).toEqual(doc.graph.groups);
  });
});
