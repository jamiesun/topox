import { describe, expect, it } from "vitest";
import type { TopoDoc } from "@talkincode/topox-core";
import { emptyDoc, validateDoc } from "@talkincode/topox-core";
import {
  docFromYaml,
  docToYaml,
  parseDot,
  parseGraphML,
  parseMermaid,
  toDot,
  toGraphML,
  toMermaid,
} from "../src/index.js";

function sampleDoc(): TopoDoc {
  const doc = emptyDoc("net-1", "Branch network");
  doc.graph.nodes = [
    { id: "fw", type: "net-firewall", label: "Edge Firewall", tags: ["prod"] },
    { id: "sw", type: "net-switch", label: "Core Switch" },
    {
      id: "srv",
      type: "net-server",
      label: "App Server",
      icon: "server",
      ref: "res-42",
      style: { fill: "#fef3c7", stroke: "#d97706", fontWeight: "bold" },
      attrs: { "rack unit": "A3" },
    },
    { id: "db", type: "net-database", label: "PostgreSQL" },
  ];
  doc.graph.edges = [
    { id: "e1", source: "fw", target: "sw", directed: true, label: "uplink" },
    { id: "e2", source: "sw", target: "srv", directed: true },
    { id: "e3", source: "srv", target: "db" },
  ];
  doc.graph.groups = [
    { id: "dc", label: "Datacenter", children: ["sw", "srv", "db", "inner"] },
    { id: "inner", label: "DB tier", children: [] },
  ];
  const view = doc.views[0]!;
  view.layout["fw"] = { x: 0, y: 0, width: 160, height: 48 };
  view.layout["sw"] = { x: 0, y: 120 };
  return doc;
}

describe("yaml", () => {
  it("round-trips a full document with zero loss", () => {
    const doc = sampleDoc();
    const back = docFromYaml(docToYaml(doc));
    expect(back).toEqual(doc);
  });

  it("rejects garbage and invalid documents", () => {
    expect(() => docFromYaml("42")).toThrow(/expected a TopoDoc/);
    expect(() =>
      docFromYaml(docToYaml(sampleDoc()).replace("target: sw", "target: ghost")),
    ).toThrow(/ghost/);
  });
});

describe("mermaid export", () => {
  it("emits flowchart with subgraphs, classes and undirected edges", () => {
    const text = toMermaid(sampleDoc());
    expect(text).toContain("flowchart TD");
    expect(text).toContain("title: Branch network");
    expect(text).toContain('fw["Edge Firewall"]:::net-firewall');
    expect(text).toContain('subgraph dc["Datacenter"]');
    expect(text).toContain('subgraph inner["DB tier"]');
    expect(text).toContain("fw -->|uplink| sw");
    expect(text).toContain("srv --- db");
  });

  it("sanitizes exotic ids", () => {
    const doc = emptyDoc("g");
    doc.graph.nodes = [
      { id: "my node", type: "t", label: "A" },
      { id: "b", type: "t", label: "B" },
    ];
    doc.graph.edges = [{ id: "e", source: "my node", target: "b", directed: true }];
    const text = toMermaid(doc);
    expect(text).toContain('my_node["A"]');
    expect(text).toContain("my_node --> b");
  });

  it("emits a bidirectional arrow for arrow: both, and forward otherwise", () => {
    const doc = emptyDoc("g");
    doc.graph.nodes = [
      { id: "a", type: "t", label: "A" },
      { id: "b", type: "t", label: "B" },
    ];
    doc.graph.edges = [
      { id: "e1", source: "a", target: "b", directed: true, arrow: "both" },
      { id: "e2", source: "a", target: "b", directed: true, arrow: "backward" },
    ];
    const text = toMermaid(doc);
    expect(text).toContain("a <--> b");
    // Mermaid has no reversed-only arrow; "backward" degrades to a plain forward one.
    expect(text).toContain("a --> b");
  });
});

describe("mermaid import", () => {
  it("parses the export back (round-trip on relational structure)", () => {
    const doc = sampleDoc();
    const { doc: back, warnings } = parseMermaid(toMermaid(doc));
    expect(warnings).toEqual([]);
    expect(back.graph.meta?.name).toBe("Branch network");
    expect(back.graph.nodes.map((n) => [n.id, n.type, n.label])).toEqual(
      expect.arrayContaining([
        ["fw", "net-firewall", "Edge Firewall"],
        ["db", "net-database", "PostgreSQL"],
      ]),
    );
    expect(back.graph.nodes).toHaveLength(4);
    const e = back.graph.edges;
    expect(e).toHaveLength(3);
    expect(e.find((x) => x.source === "fw")).toMatchObject({ target: "sw", directed: true, label: "uplink" });
    expect(e.find((x) => x.source === "srv")).not.toHaveProperty("directed");
    const dc = back.graph.groups.find((g) => g.id === "dc")!;
    expect(dc.children).toEqual(expect.arrayContaining(["sw", "srv", "db", "inner"]));
    expect(validateDoc(back).filter((x) => x.severity === "error")).toEqual([]);
  });

  it("parses hand-written LLM-style flowcharts with chains, & fans and inline labels", () => {
    const { doc, warnings } = parseMermaid(`
graph LR
  a[Agent 1] & b[Agent 2] --> r{Router}
  r -- query --> db[(Database)]
  db -.-> log
  c((cache)):::infra
  class a,b agent
`);
    expect(warnings).toEqual([]);
    const byId = new Map(doc.graph.nodes.map((n) => [n.id, n]));
    expect(byId.get("a")).toMatchObject({ label: "Agent 1", type: "agent" });
    expect(byId.get("r")).toMatchObject({ label: "Router" });
    expect(byId.get("db")).toMatchObject({ label: "Database" });
    expect(byId.get("c")).toMatchObject({ label: "cache", type: "infra" });
    expect(byId.get("log")).toBeDefined();
    expect(doc.graph.edges).toHaveLength(4);
    expect(doc.graph.edges.find((e) => e.label === "query")).toMatchObject({
      source: "r",
      target: "db",
      directed: true,
    });
  });

  it("imports <--> as a directed edge with arrow: both (no lossy fallback)", () => {
    const { doc, warnings } = parseMermaid(`
flowchart LR
  a --> b
  b <--> c
`);
    expect(warnings).toEqual([]);
    expect(doc.graph.edges.find((e) => e.source === "a")).toMatchObject({ directed: true });
    expect(doc.graph.edges.find((e) => e.source === "a")?.arrow).toBeUndefined();
    expect(doc.graph.edges.find((e) => e.source === "b")).toMatchObject({
      target: "c",
      directed: true,
      arrow: "both",
    });
  });
});

describe("dot interop", () => {
  it("exports labels, types, direction, edge labels, and nested clusters", () => {
    const text = toDot(sampleDoc());

    expect(text).toContain('digraph "net-1"');
    expect(text).toContain('subgraph "cluster_dc"');
    expect(text).toContain('label="Datacenter"');
    expect(text).toContain('"fw" [label="Edge Firewall", topox_type="net-firewall"');
    expect(text).toContain('"fw" -> "sw" [id="e1", label="uplink"');
    expect(text).toContain('"srv" -> "db" [id="e3", dir=none');
  });

  it("round-trips the relational subset and tolerates unsupported statements", () => {
    const { doc: back, warnings } = parseDot(toDot(sampleDoc()));
    expect(warnings).toEqual([]);
    expect(back.graph.meta?.name).toBe("Branch network");
    expect(back.graph.nodes.find((node) => node.id === "fw")).toMatchObject({
      label: "Edge Firewall",
      type: "net-firewall",
    });
    expect(back.graph.nodes.find((node) => node.id === "srv")).toMatchObject({
      icon: "server",
      style: { fill: "#fef3c7", stroke: "#d97706", fontWeight: "bold" },
      attrs: { "rack unit": "A3" },
    });
    expect(back.graph.groups.find((group) => group.id === "dc")?.children).toEqual(
      expect.arrayContaining(["sw", "srv", "db", "inner"]),
    );
    expect(back.graph.edges.find((edge) => edge.id === "e1")).toMatchObject({
      source: "fw",
      target: "sw",
      directed: true,
      label: "uplink",
    });
    expect(back.graph.edges.find((edge) => edge.id === "e3")?.directed).not.toBe(true);
    expect(validateDoc(back).filter((issue) => issue.severity === "error")).toEqual([]);

    const tolerant = parseDot(`
  digraph G {
    a [label="Router", topox_type="net-router"];
    unsupported ???;
    a -> b [label="uplink"];
  }
  `);
    expect(tolerant.warnings).toHaveLength(1);
    expect(tolerant.doc.graph.nodes.map((node) => node.id)).toEqual(["a", "b"]);
    expect(tolerant.doc.graph.edges[0]).toMatchObject({
      source: "a",
      target: "b",
      directed: true,
      label: "uplink",
    });
    expect(() => parseDot("not a dot graph")).toThrow(/graph or digraph/i);
  });

  it("round-trips arrow direction via the dir attribute", () => {
    const doc = emptyDoc("g");
    doc.graph.nodes = [
      { id: "a", type: "t", label: "A" },
      { id: "b", type: "t", label: "B" },
    ];
    doc.graph.edges = [
      { id: "e1", source: "a", target: "b", directed: true, arrow: "backward" },
      { id: "e2", source: "a", target: "b", directed: true, arrow: "both" },
      { id: "e3", source: "a", target: "b", directed: true },
    ];

    const text = toDot(doc);
    expect(text).toContain('"a" -> "b" [id="e1", dir=back]');
    expect(text).toContain('"a" -> "b" [id="e2", dir=both]');
    expect(text).toContain('"a" -> "b" [id="e3"]');

    const { doc: back, warnings } = parseDot(text);
    expect(warnings).toEqual([]);
    expect(back.graph.edges.find((e) => e.id === "e1")).toMatchObject({
      directed: true,
      arrow: "backward",
    });
    expect(back.graph.edges.find((e) => e.id === "e2")).toMatchObject({
      directed: true,
      arrow: "both",
    });
    expect(back.graph.edges.find((e) => e.id === "e3")?.arrow).toBeUndefined();
  });
});

describe("graphml interop", () => {
    it("exports keys, custom data, nested groups, edge direction, and available layout", () => {
      const text = toGraphML(sampleDoc());

      expect(text).toContain('xmlns="http://graphml.graphdrawing.org/xmlns"');
      expect(text).toContain('attr.name="type"');
      expect(text).toContain('attr.name="rack unit"');
      expect(text).toContain('topox:scope="group"');
      expect(text).toContain('<graph id="topox_group_6463_graph"');
      expect(text).toContain('directed="false"');
      expect(text).toContain('attr.name="x"');
    });

    it("round-trips custom data and safely skips malformed or namespaced extensions", () => {
      const { doc: back, warnings } = parseGraphML(toGraphML(sampleDoc()));
      expect(warnings).toEqual([]);
      expect(back.graph.id).toBe("net-1");
      expect(back.graph.nodes.find((node) => node.id === "srv")).toMatchObject({
        label: "App Server",
        type: "net-server",
        icon: "server",
        ref: "res-42",
        style: { fill: "#fef3c7", stroke: "#d97706", fontWeight: "bold" },
        attrs: { "rack unit": "A3" },
      });
      expect(back.graph.groups.find((group) => group.id === "dc")?.children).toEqual(
        expect.arrayContaining(["sw", "srv", "db", "inner"]),
      );
      expect(back.graph.edges.find((edge) => edge.id === "e3")?.directed).not.toBe(true);
      expect(back.views[0]?.layout.fw).toEqual({ x: 0, y: 0, width: 160, height: 48 });

      const tolerant = parseGraphML(`<?xml version="1.0"?>
  <graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:y="http://www.yworks.com/xml/graphml">
    <key id="label" for="node" attr.name="label" attr.type="string"/>
    <key id="vendor" for="node" attr.name="vendor" attr.type="string"/>
    <key id="yfiles" for="node" yfiles.type="nodegraphics"/>
    <graph id="G" edgedefault="directed">
      <node id="a">
        <data key="label">Router A</data>
        <data key="vendor">MikroTik</data>
        <data key="yfiles"><y:ShapeNode/></data>
      </node>
      <node/>
      <node id="b"/>
      <edge id="e1" source="a" target="b"/>
      <edge id="broken" source="a" target="missing"/>
    </graph>
  </graphml>`);
      expect(tolerant.doc.graph.nodes.find((node) => node.id === "a")).toEqual({
        id: "a",
        type: "default",
        label: "Router A",
        attrs: { vendor: "MikroTik" },
      });
      expect(tolerant.doc.graph.edges).toHaveLength(1);
      expect(tolerant.warnings).toHaveLength(2);
      expect(() => parseGraphML("<graphml><graph>")).toThrow(/XML|GraphML/i);
    });

    it("uses schema-safe XML ids while preserving arbitrary TopoX ids", () => {
      const doc = emptyDoc("graph / α");
      doc.graph.nodes = [{ id: "router / α", type: "device", label: "Router" }];

      const text = toGraphML(doc);
      expect(text).not.toMatch(/\sid="[^"]*%/);
      const back = parseGraphML(text).doc;
      expect(back.graph.id).toBe("graph / α");
      expect(back.graph.nodes[0]?.id).toBe("router / α");
    });

    it("round-trips arrow direction via the topox_edge_arrow key", () => {
      const doc = emptyDoc("g");
      doc.graph.nodes = [
        { id: "a", type: "t", label: "A" },
        { id: "b", type: "t", label: "B" },
      ];
      doc.graph.edges = [
        { id: "e1", source: "a", target: "b", directed: true, arrow: "backward" },
        { id: "e2", source: "a", target: "b", directed: true, arrow: "both" },
        { id: "e3", source: "a", target: "b", directed: true },
      ];

      const text = toGraphML(doc);
      expect(text).toContain('<key id="topox_edge_arrow" for="edge" attr.name="arrow"');

      const { doc: back, warnings } = parseGraphML(text);
      expect(warnings).toEqual([]);
      expect(back.graph.edges.find((e) => e.id === "e1")).toMatchObject({
        directed: true,
        arrow: "backward",
      });
      expect(back.graph.edges.find((e) => e.id === "e2")).toMatchObject({
        directed: true,
        arrow: "both",
      });
      expect(back.graph.edges.find((e) => e.id === "e3")?.arrow).toBeUndefined();
    });
});

describe("mermaid import groups and warnings", () => {
  it("assigns nodes to the innermost subgraph and nests groups", () => {
    const { doc } = parseMermaid(`
flowchart TD
  subgraph outer["Outer"]
    subgraph inner
      x[X]
    end
    y[Y]
  end
  x --> y
`);
    const outer = doc.graph.groups.find((g) => g.id === "outer")!;
    const inner = doc.graph.groups.find((g) => g.id === "inner")!;
    expect(outer.children).toContain("inner");
    expect(outer.children).toContain("y");
    expect(inner.children).toEqual(["x"]);
  });

  it("survives junk lines with warnings instead of failing", () => {
    const { doc, warnings } = parseMermaid(`
flowchart TD
  a --> b
  ???: not mermaid at all
  end
`);
    expect(doc.graph.nodes).toHaveLength(2);
    expect(doc.graph.edges).toHaveLength(1);
    expect(warnings.length).toBeGreaterThanOrEqual(2);
  });
});
