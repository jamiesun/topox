import { describe, expect, it } from "vitest";
import type { TopoDoc } from "@topox/core";
import { emptyDoc, validateDoc } from "@topox/core";
import { docFromYaml, docToYaml, parseMermaid, toMermaid } from "../src/index.js";

function sampleDoc(): TopoDoc {
  const doc = emptyDoc("net-1", "Branch network");
  doc.graph.nodes = [
    { id: "fw", type: "net-firewall", label: "Edge Firewall", tags: ["prod"] },
    { id: "sw", type: "net-switch", label: "Core Switch" },
    { id: "srv", type: "net-server", label: "App Server", ref: "res-42", attrs: { rack: "A3" } },
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
