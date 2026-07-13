import type { AttrValue, TopoDoc } from "@topox/core";

function quote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function scalar(value: AttrValue): string {
  if (typeof value === "string") return /[\s"#=]/.test(value) || value === "" ? quote(value) : value;
  return JSON.stringify(value);
}

function needsQuote(value: string): boolean {
  return /[\s"#=]/.test(value) || value === "";
}

/**
 * Serializes a document's graph as DSL. Used to show an LLM the current
 * topology in the same language it must answer in.
 */
export function docToDsl(doc: TopoDoc): string {
  const lines: string[] = [];
  for (const node of doc.graph.nodes) {
    const parts = [`node ${node.id}`];
    if (node.label !== node.id) parts.push(quote(node.label));
    if (node.type !== "default") parts.push(`type=${node.type}`);
    if (node.ref !== undefined) parts.push(`ref=${needsQuote(node.ref) ? quote(node.ref) : node.ref}`);
    if (node.icon !== undefined) parts.push(`icon=${node.icon}`);
    if (node.description !== undefined) parts.push(`desc=${quote(node.description)}`);
    if (node.tags && node.tags.length > 0) parts.push(`tags=${node.tags.join(",")}`);
    for (const [key, value] of Object.entries(node.attrs ?? {})) {
      parts.push(`${key}=${scalar(value)}`);
    }
    lines.push(parts.join(" "));
  }
  for (const edge of doc.graph.edges) {
    const arrow = edge.directed ? "->" : "--";
    const parts = [`edge ${edge.source} ${arrow} ${edge.target}`];
    parts.push(`id=${edge.id}`);
    if (edge.label !== undefined) parts.push(`label=${needsQuote(edge.label) ? quote(edge.label) : edge.label}`);
    if (edge.type !== undefined) parts.push(`type=${edge.type}`);
    if (edge.color !== undefined) parts.push(`color=${edge.color}`);
    if (edge.weight !== undefined) parts.push(`weight=${edge.weight}`);
    for (const [key, value] of Object.entries(edge.attrs ?? {})) {
      parts.push(`${key}=${scalar(value)}`);
    }
    lines.push(parts.join(" "));
  }
  for (const group of doc.graph.groups) {
    const parts = [`group ${group.id}`];
    if (group.label !== group.id) parts.push(quote(group.label));
    if (group.children.length > 0) parts.push(`children=${group.children.join(",")}`);
    if (group.collapsed) parts.push("collapsed=true");
    lines.push(parts.join(" "));
  }
  return lines.join("\n");
}

/** Compact grammar reference, meant to be embedded in an LLM system prompt. */
export const DSL_GUIDE = `TopoX DSL — one statement per line, # starts a comment.

node <id> ["label"] [type=<t>] [ref=<r>] [tags=a,b] [desc="..."] [key=value ...]
  Creates or updates a node. Unknown keys become custom attrs.
edge <src> -> <dst> ["label"] [id=<e>] [color=<c>] [weight=<n>] [key=value ...]
  Directed edge. Use -- for undirected. Endpoints must exist (earlier lines count).
group <id> ["label"] children=a,b,c
set node|edge|group <id> key=value ...   # update; value null deletes the key
remove node|edge|group <id>              # removing a node also removes its edges

Rules:
- ids are short slugs (kebab-case). Never reuse an existing id for a new element.
- Only output DSL statements, no prose, no code fences.`;
