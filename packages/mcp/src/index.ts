#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createTopoxMcpHandlers } from "./handlers.js";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function jsonText(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

async function main() {
  const docPath = argValue("--doc");
  if (!docPath) {
    throw new Error("usage: topox-mcp --doc <topox-doc-path> [--proposal-dir <dir>]");
  }
  const proposalDir = argValue("--proposal-dir") ?? ".topox/proposals";
  const handlers = createTopoxMcpHandlers({ docPath, proposalDir });
  const server = new McpServer({ name: "topox-mcp", version: "0.1.0" });

  server.tool("topox_get_doc", "Read the current TopoDoc snapshot and graph hash.", {}, async () =>
    jsonText(await handlers.getDoc()),
  );
  server.tool("topox_get_inventory", "Read the current topology inventory projection.", {}, async () =>
    jsonText(await handlers.getInventory()),
  );
  server.tool("topox_validate_doc", "Validate the current TopoDoc.", {}, async () =>
    jsonText(await handlers.validateDoc()),
  );
  server.tool("topox_doc_to_dsl", "Serialize the current TopoDoc to TopoX DSL.", {}, async () =>
    jsonText(await handlers.docToDsl()),
  );
  server.tool(
    "topox_compile_dsl",
    "Compile TopoX DSL against the current document into a GraphDiff proposal.",
    { dsl: z.string() },
    async (input) => jsonText(await handlers.compileDsl(input)),
  );
  server.tool(
    "topox_preview_diff",
    "Preview a GraphDiff against the current document without mutating it.",
    { diff: z.any(), baseHash: z.string().optional() },
    async (input) => jsonText(await handlers.previewDiff(input)),
  );
  server.tool(
    "topox_create_proposal",
    "Create a versioned TopoX proposal artifact from DSL.",
    { dsl: z.string(), prompt: z.string().optional(), proposalId: z.string().optional() },
    async (input) => jsonText(await handlers.createProposal(input)),
  );
  server.tool(
    "topox_preview_proposal",
    "Preview an existing proposal artifact against the current document.",
    { proposalPath: z.string() },
    async (input) => jsonText(await handlers.previewProposal(input)),
  );
  server.tool(
    "topox_import_text",
    "Parse topology text into a TopoDoc without replacing the current document.",
    { name: z.string(), text: z.string() },
    async (input) => jsonText(await handlers.importText(input)),
  );
  server.tool(
    "topox_export_text",
    "Serialize the current TopoDoc to a supported text format.",
    { format: z.string() },
    async (input) => jsonText(await handlers.exportText(input)),
  );

  await server.connect(new StdioServerTransport());
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
