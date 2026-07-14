import { applyDiff } from "./diff.js";
import { hashDocGraph } from "./hash.js";
import type { GraphDiff, TopoDoc, ValidationIssue } from "./types.js";
import { validateDoc } from "./validate.js";

export const TOPOX_PROPOSAL_FORMAT = "topox-proposal";
export const TOPOX_PROPOSAL_VERSION = 1;

export interface DiffSummaryItem {
  sign: "+" | "-" | "~";
  text: string;
}

export interface GraphProposal {
  format: typeof TOPOX_PROPOSAL_FORMAT;
  version: typeof TOPOX_PROPOSAL_VERSION;
  proposalId: string;
  docId: string;
  baseHash: string;
  createdAt: string;
  source: string;
  prompt?: string;
  dsl?: string;
  diff: GraphDiff;
  summary: readonly DiffSummaryItem[];
  compileErrors?: readonly { line: number; message: string; source: string }[];
  validationIssues?: readonly ValidationIssue[];
  status?: "open" | "applied" | "discarded";
}

export interface ProposalPreview {
  state: "ready" | "stale" | "unverifiable" | "invalid";
  baseHash: string;
  currentHash?: string;
  doc?: TopoDoc;
  issues: readonly ValidationIssue[];
  error?: string;
}

function hasObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDiff(value: unknown): value is GraphDiff {
  return hasObject(value) && Array.isArray(value["ops"]);
}

function parseSummary(value: unknown): readonly DiffSummaryItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is DiffSummaryItem => {
    if (!hasObject(item)) return false;
    const sign = item["sign"];
    return (
      (sign === "+" || sign === "-" || sign === "~") &&
      typeof item["text"] === "string"
    );
  });
}

export function parseGraphProposal(value: unknown): GraphProposal {
  if (!hasObject(value)) throw new Error("proposal must be an object");
  if (value["format"] !== TOPOX_PROPOSAL_FORMAT) throw new Error("unsupported proposal format");
  if (value["version"] !== TOPOX_PROPOSAL_VERSION) {
    throw new Error(`unsupported proposal version: ${String(value["version"])}`);
  }
  if (typeof value["proposalId"] !== "string" || value["proposalId"] === "") {
    throw new Error("proposalId is required");
  }
  if (typeof value["docId"] !== "string" || value["docId"] === "") {
    throw new Error("docId is required");
  }
  if (typeof value["baseHash"] !== "string" || value["baseHash"] === "") {
    throw new Error("baseHash is required");
  }
  if (typeof value["createdAt"] !== "string" || value["createdAt"] === "") {
    throw new Error("createdAt is required");
  }
  if (typeof value["source"] !== "string" || value["source"] === "") {
    throw new Error("source is required");
  }
  if (!isDiff(value["diff"])) throw new Error("diff.ops is required");

  const proposal: GraphProposal = {
    format: TOPOX_PROPOSAL_FORMAT,
    version: TOPOX_PROPOSAL_VERSION,
    proposalId: value["proposalId"],
    docId: value["docId"],
    baseHash: value["baseHash"],
    createdAt: value["createdAt"],
    source: value["source"],
    diff: value["diff"],
    summary: parseSummary(value["summary"]),
  };
  if (typeof value["prompt"] === "string") proposal.prompt = value["prompt"];
  if (typeof value["dsl"] === "string") proposal.dsl = value["dsl"];
  if (Array.isArray(value["compileErrors"])) {
    const compileErrors: NonNullable<GraphProposal["compileErrors"]> = value["compileErrors"].filter((item) =>
      hasObject(item) &&
      typeof item["line"] === "number" &&
      typeof item["message"] === "string" &&
      typeof item["source"] === "string",
    ) as NonNullable<GraphProposal["compileErrors"]>;
    proposal.compileErrors = compileErrors;
  }
  if (Array.isArray(value["validationIssues"])) {
    const validationIssues: NonNullable<GraphProposal["validationIssues"]> = value["validationIssues"].filter((item) =>
      hasObject(item) &&
      (item["severity"] === "error" || item["severity"] === "warning") &&
      typeof item["code"] === "string" &&
      typeof item["message"] === "string",
    ) as NonNullable<GraphProposal["validationIssues"]>;
    proposal.validationIssues = validationIssues;
  }
  if (
    value["status"] === "open" ||
    value["status"] === "applied" ||
    value["status"] === "discarded"
  ) {
    proposal.status = value["status"];
  }
  return proposal;
}

export function previewGraphProposal(
  doc: TopoDoc,
  proposal: GraphProposal,
  options: { verifyBase?: boolean } = {},
): ProposalPreview {
  const currentHash = hashDocGraph(doc);
  if (options.verifyBase === true && currentHash !== proposal.baseHash) {
    return {
      state: "stale",
      baseHash: proposal.baseHash,
      currentHash,
      issues: [],
      error: "proposal base does not match current document",
    };
  }
  if (options.verifyBase !== true) {
    return {
      state: "unverifiable",
      baseHash: proposal.baseHash,
      currentHash,
      issues: [],
      error: "proposal base can only be verified in shared document mode",
    };
  }
  try {
    const preview = applyDiff(doc, proposal.diff);
    const issues = validateDoc(preview);
    if (issues.some((issue) => issue.severity === "error")) {
      return { state: "invalid", baseHash: proposal.baseHash, currentHash, issues };
    }
    return { state: "ready", baseHash: proposal.baseHash, currentHash, doc: preview, issues };
  } catch (e) {
    return {
      state: "invalid",
      baseHash: proposal.baseHash,
      currentHash,
      issues: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function summarizeDiff(diff: GraphDiff): DiffSummaryItem[] {
  return diff.ops.map((op): DiffSummaryItem => {
    switch (op.op) {
      case "add_node":
        return { sign: "+", text: `node ${op.node.id} (${op.node.label})` };
      case "remove_node":
        return { sign: "-", text: `node ${op.node.id} (${op.node.label})` };
      case "update_node":
        return { sign: "~", text: `node ${op.id}: ${Object.keys(op.after).join(", ")}` };
      case "add_edge":
        return { sign: "+", text: `edge ${op.edge.source} -> ${op.edge.target}` };
      case "remove_edge":
        return { sign: "-", text: `edge ${op.edge.source} -> ${op.edge.target}` };
      case "update_edge":
        return { sign: "~", text: `edge ${op.id}: ${Object.keys(op.after).join(", ")}` };
      case "add_group":
        return { sign: "+", text: `group ${op.group.id}` };
      case "remove_group":
        return { sign: "-", text: `group ${op.group.id}` };
      case "update_group":
        return { sign: "~", text: `group ${op.id}: ${Object.keys(op.after).join(", ")}` };
      case "update_meta":
        return { sign: "~", text: "graph meta" };
      case "add_view":
        return { sign: "+", text: `view ${op.view.id}` };
      case "remove_view":
        return { sign: "-", text: `view ${op.view.id}` };
      case "set_layout":
        return { sign: "~", text: `layout ${op.nodeId}` };
    }
  });
}
