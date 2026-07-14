import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  applyDiff,
  hashDocGraph,
  inventoryToCsv,
  parseGraphProposal,
  previewGraphProposal,
  summarizeDiff,
  toInventory,
  validateDoc,
  type GraphDiff,
  type GraphProposal,
  type TopoDoc,
} from "@talkincode/topox-core";
import { compileDsl, docToDsl } from "@talkincode/topox-dsl";
import {
  docFromYaml,
  docToYaml,
  parseDot,
  parseGraphML,
  parseMermaid,
  toDot,
  toGraphML,
  toMermaid,
} from "@talkincode/topox-interop";

export interface TopoxMcpOptions {
  docPath: string;
  proposalDir: string;
}

export interface LoadedDoc {
  doc: TopoDoc;
  docId: string;
  baseHash: string;
}

function assertDoc(value: unknown): TopoDoc {
  if (
    value === null ||
    typeof value !== "object" ||
    !("graph" in value) ||
    !("views" in value)
  ) {
    throw new Error("expected a TopoDoc: { graph, views }");
  }
  const doc = value as TopoDoc;
  const problems = validateDoc(doc).filter((i) => i.severity === "error");
  if (problems.length > 0) throw new Error(problems.map((p) => p.message).join("; "));
  return doc;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "proposal";
}

export function parseDocText(name: string, raw: string): TopoDoc {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "yaml" || ext === "yml") return docFromYaml(raw);
  if (ext === "mmd" || ext === "mermaid") return parseMermaid(raw).doc;
  if (ext === "dot" || ext === "gv") return parseDot(raw).doc;
  if (ext === "graphml") return parseGraphML(raw).doc;
  return assertDoc(JSON.parse(raw));
}

export function serializeDoc(format: string, doc: TopoDoc): string {
  switch (format) {
    case "json":
      return JSON.stringify(doc, null, 2);
    case "yaml":
    case "yml":
      return docToYaml(doc);
    case "mermaid":
    case "mmd":
      return toMermaid(doc);
    case "dot":
    case "gv":
      return toDot(doc);
    case "graphml":
      return toGraphML(doc);
    case "csv":
      return inventoryToCsv(toInventory(doc.graph));
    default:
      throw new Error(`unsupported export format: ${format}`);
  }
}

export function createTopoxMcpHandlers(options: TopoxMcpOptions) {
  const docPath = resolve(options.docPath);
  const proposalDir = resolve(options.proposalDir);

  const loadDoc = async (): Promise<LoadedDoc> => {
    const raw = await readFile(docPath, "utf8");
    const doc = parseDocText(docPath, raw);
    return {
      doc,
      docId: doc.graph.id || basename(docPath),
      baseHash: hashDocGraph(doc),
    };
  };

  const readProposal = async (proposalPath: string): Promise<GraphProposal> => {
    const raw = await readFile(resolve(proposalPath), "utf8");
    return parseGraphProposal(JSON.parse(raw));
  };

  return {
    async getDoc() {
      const loaded = await loadDoc();
      return loaded;
    },

    async getInventory() {
      const { doc, docId, baseHash } = await loadDoc();
      return { docId, baseHash, rows: toInventory(doc.graph) };
    },

    async validateDoc() {
      const { doc, docId, baseHash } = await loadDoc();
      return { docId, baseHash, issues: validateDoc(doc) };
    },

    async docToDsl() {
      const { doc, docId, baseHash } = await loadDoc();
      return { docId, baseHash, dsl: docToDsl(doc) };
    },

    async compileDsl(input: { dsl: string }) {
      const { doc, docId, baseHash } = await loadDoc();
      const compiled = compileDsl(input.dsl, doc);
      return {
        docId,
        baseHash,
        diff: compiled.diff,
        summary: summarizeDiff(compiled.diff),
        errors: compiled.errors,
      };
    },

    async previewDiff(input: { diff: GraphDiff; baseHash?: string | undefined }) {
      const { doc, docId, baseHash } = await loadDoc();
      const proposal = parseGraphProposal({
        format: "topox-proposal",
        version: 1,
        proposalId: "preview",
        docId,
        baseHash: input.baseHash ?? baseHash,
        createdAt: new Date().toISOString(),
        source: "mcp/preview",
        diff: input.diff,
        summary: summarizeDiff(input.diff),
      });
      const preview = previewGraphProposal(doc, proposal, { verifyBase: true });
      return {
        docId,
        baseHash,
        preview,
        summary: summarizeDiff(input.diff),
      };
    },

    async createProposal(input: { dsl: string; prompt?: string | undefined; proposalId?: string | undefined }) {
      const { doc, docId, baseHash } = await loadDoc();
      const compiled = compileDsl(input.dsl, doc);
      const proposalId = safeId(input.proposalId ?? `p-${new Date().toISOString().replace(/[:.]/g, "-")}`);
      let validationIssues = [];
      try {
        validationIssues = validateDoc(applyDiff(doc, compiled.diff));
      } catch (e) {
        validationIssues = [{
          severity: "error" as const,
          code: "preview_failed",
          message: e instanceof Error ? e.message : String(e),
        }];
      }
      const proposal: GraphProposal = {
        format: "topox-proposal",
        version: 1,
        proposalId,
        docId,
        baseHash,
        createdAt: new Date().toISOString(),
        source: "mcp",
        ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
        dsl: input.dsl,
        diff: compiled.diff,
        summary: summarizeDiff(compiled.diff),
        compileErrors: compiled.errors,
        validationIssues,
        status: "open",
      };
      await mkdir(proposalDir, { recursive: true });
      const path = join(proposalDir, `${proposalId}.json`);
      await writeFile(path, `${JSON.stringify(proposal, null, 2)}\n`, "utf8");
      return { proposalId, path, proposal };
    },

    async previewProposal(input: { proposalPath: string }) {
      const { doc, docId, baseHash } = await loadDoc();
      const proposal = await readProposal(input.proposalPath);
      return {
        docId,
        baseHash,
        proposal,
        preview: previewGraphProposal(doc, proposal, { verifyBase: true }),
      };
    },

    async importText(input: { name: string; text: string }) {
      const doc = parseDocText(input.name, input.text);
      return { doc, baseHash: hashDocGraph(doc), issues: validateDoc(doc) };
    },

    async exportText(input: { format: string }) {
      const { doc, docId, baseHash } = await loadDoc();
      return { docId, baseHash, text: serializeDoc(input.format, doc) };
    },

    paths() {
      return { docPath, proposalDir, proposalParent: dirname(proposalDir) };
    },
  };
}

export type TopoxMcpHandlers = ReturnType<typeof createTopoxMcpHandlers>;
