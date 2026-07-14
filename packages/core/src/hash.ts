import type { Graph, TopoDoc } from "./types.js";

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("cannot hash non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  throw new Error(`cannot hash ${typeof value}`);
}

function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}

/** Stable, key-order-insensitive JSON for TopoX wire artifacts. */
export function canonicalJson(value: unknown): string {
  return canonicalize(value);
}

/**
 * Hashes only graph data for proposal staleness checks. Views/layout are
 * intentionally excluded so a canvas drag does not stale semantic proposals.
 */
export function hashGraph(graph: Graph): string {
  return `fnv1a64:${fnv1a64(canonicalJson(graph))}`;
}

export function hashDocGraph(doc: TopoDoc): string {
  return hashGraph(doc.graph);
}
