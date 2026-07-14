import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { applyDiff, emptyDoc, hashDocGraph, type TopoDoc } from "@talkincode/topox-core";
import { createTopoxMcpHandlers } from "../src/handlers.js";

function fixtureDoc(): TopoDoc {
  return applyDiff(emptyDoc("mcp-doc", "MCP Doc"), {
    ops: [
      { op: "add_node", node: { id: "a", type: "net-router", label: "A" } },
      { op: "add_node", node: { id: "b", type: "net-server", label: "B" } },
      { op: "add_edge", edge: { id: "ab", source: "a", target: "b", directed: true } },
    ],
  });
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "topox-mcp-"));
  const docPath = join(dir, "doc.topox.json");
  const proposalDir = join(dir, "proposals");
  const doc = fixtureDoc();
  await writeFile(docPath, JSON.stringify(doc), "utf8");
  return { dir, docPath, proposalDir, doc };
}

describe("MCP handlers", () => {
  it("re-reads the document on every call", async () => {
    const { docPath, proposalDir, doc } = await setup();
    const handlers = createTopoxMcpHandlers({ docPath, proposalDir });
    const first = await handlers.getDoc();
    expect(first.baseHash).toBe(hashDocGraph(doc));

    const next = applyDiff(doc, {
      ops: [{ op: "update_node", id: "a", before: { label: "A" }, after: { label: "A+" } }],
    });
    await writeFile(docPath, JSON.stringify(next), "utf8");
    const second = await handlers.getDoc();
    expect(second.baseHash).toBe(hashDocGraph(next));
    expect(second.baseHash).not.toBe(first.baseHash);
  });

  it("compiles DSL and creates a versioned proposal artifact", async () => {
    const { docPath, proposalDir, doc } = await setup();
    const handlers = createTopoxMcpHandlers({ docPath, proposalDir });
    const created = await handlers.createProposal({
      proposalId: "router-rename",
      dsl: 'node a "A+" type=net-router',
      prompt: "rename router",
    });
    expect(created.proposal.baseHash).toBe(hashDocGraph(doc));
    expect(created.proposal.diff.ops).toHaveLength(1);
    expect(created.proposal.status).toBe("open");

    const raw = JSON.parse(await readFile(created.path, "utf8")) as { format?: string };
    expect(raw.format).toBe("topox-proposal");
  });

  it("previews stale diffs without mutating the source doc", async () => {
    const { docPath, proposalDir } = await setup();
    const handlers = createTopoxMcpHandlers({ docPath, proposalDir });
    const preview = await handlers.previewDiff({
      baseHash: "fnv1a64:not-current",
      diff: { ops: [] },
    });
    expect(preview.preview.state).toBe("stale");
    const loaded = await handlers.getDoc();
    expect(loaded.doc.graph.nodes.find((node) => node.id === "a")?.label).toBe("A");
  });
});
