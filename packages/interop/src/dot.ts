/**
 * Graphviz DOT interop for a deliberately small, line-oriented common subset.
 * Export always uses a digraph; undirected TopoX edges use `dir=none`.
 */
import type { AttrValue, Edge, Group, Node, TopoDoc } from "@topox/core";
import { emptyDoc } from "@topox/core";
import { hexToUtf8, parseNodeStyleAttribute, utf8ToHex } from "./encoding.js";

export interface DotParseResult {
  doc: TopoDoc;
  warnings: string[];
}

function escapeDot(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r");
}

function quoteDot(value: string): string {
  return `"${escapeDot(value)}"`;
}

function dotAttributes(entries: [string, string, quoted?: boolean][]): string {
  if (entries.length === 0) return "";
  return ` [${entries
    .map(([key, value, quoted = true]) => `${key}=${quoted ? quoteDot(value) : value}`)
    .join(", ")}]`;
}

function customDotAttributes(attrs: Record<string, AttrValue> | undefined) {
  return Object.entries(attrs ?? {}).map(
    ([key, value]): [string, string] => [
      `topox_attr_h${utf8ToHex(key)}`,
      JSON.stringify(value),
    ],
  );
}

function nodeAttributes(node: Node): [string, string, boolean?][] {
  return [
    ["label", node.label],
    ["topox_type", node.type],
    ...(node.ref !== undefined ? ([["topox_ref", node.ref]] as [string, string][]) : []),
    ...(node.description !== undefined
      ? ([["topox_description", node.description]] as [string, string][])
      : []),
    ...(node.icon !== undefined ? ([["topox_icon", node.icon]] as [string, string][]) : []),
    ...(node.style !== undefined
      ? ([["topox_style", JSON.stringify(node.style)]] as [string, string][])
      : []),
    ...(node.tags !== undefined
      ? ([["topox_tags", JSON.stringify(node.tags)]] as [string, string][])
      : []),
    ...(node.locked === true
      ? ([["topox_locked", "true", false]] as [string, string, boolean][])
      : []),
    ...customDotAttributes(node.attrs),
  ];
}

function groupDotId(id: string): string {
  return `cluster_${encodeURIComponent(id)}`;
}

export function toDot(doc: TopoDoc): string {
  const { graph } = doc;
  const lines = [`digraph ${quoteDot(graph.id)} {`];
  if (graph.meta?.name !== undefined) {
    lines.push(`  graph${dotAttributes([["label", graph.meta.name]])};`);
  }

  const groups = new Map(graph.groups.map((group) => [group.id, group]));
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const parentOf = new Map<string, string>();
  for (const group of graph.groups) {
    for (const child of group.children) parentOf.set(child, group.id);
  }

  const emitNode = (node: Node, indent: string) => {
    lines.push(`${indent}${quoteDot(node.id)}${dotAttributes(nodeAttributes(node))};`);
  };
  const emitGroup = (group: Group, indent: string) => {
    lines.push(`${indent}subgraph ${quoteDot(groupDotId(group.id))} {`);
    lines.push(`${indent}  label=${quoteDot(group.label)};`);
    for (const childId of group.children) {
      const childGroup = groups.get(childId);
      if (childGroup !== undefined) {
        emitGroup(childGroup, `${indent}  `);
        continue;
      }
      const node = nodes.get(childId);
      if (node !== undefined) emitNode(node, `${indent}  `);
    }
    lines.push(`${indent}}`);
  };

  for (const group of graph.groups) {
    if (!parentOf.has(group.id)) emitGroup(group, "  ");
  }
  for (const node of graph.nodes) {
    if (!parentOf.has(node.id)) emitNode(node, "  ");
  }

  for (const edge of graph.edges) {
    const attrs: [string, string, boolean?][] = [["id", edge.id]];
    if (edge.label !== undefined) attrs.push(["label", edge.label]);
    if (edge.directed !== true) attrs.push(["dir", "none", false]);
    else if (edge.arrow === "backward") attrs.push(["dir", "back", false]);
    else if (edge.arrow === "both") attrs.push(["dir", "both", false]);
    if (edge.type !== undefined) attrs.push(["topox_type", edge.type]);
    attrs.push(...customDotAttributes(edge.attrs));
    lines.push(
      `  ${quoteDot(edge.source)} -> ${quoteDot(edge.target)}${dotAttributes(attrs)};`,
    );
  }
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

interface DotStatement {
  text: string;
  line: number;
}

function stripDotComments(text: string): string {
  const withoutBlocks = text.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, " "),
  );
  return withoutBlocks
    .split(/\r?\n/)
    .map((line) => {
      let quoted = false;
      let escaped = false;
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index]!;
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === '"') quoted = !quoted;
        if (!quoted && char === "#") return line.slice(0, index);
        if (!quoted && char === "/" && line[index + 1] === "/") {
          return line.slice(0, index);
        }
      }
      return line;
    })
    .join("\n");
}

function dotStatements(text: string): DotStatement[] {
  const statements: DotStatement[] = [];
  let buffer = "";
  let line = 1;
  let startLine = 1;
  let quoted = false;
  let escaped = false;
  let attributeDepth = 0;
  const flush = () => {
    const statement = buffer.trim();
    if (statement !== "") statements.push({ text: statement, line: startLine });
    buffer = "";
    startLine = line;
  };

  for (const char of stripDotComments(text)) {
    if (escaped) {
      buffer += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      buffer += char;
      escaped = true;
      continue;
    }
    if (char === '"') quoted = !quoted;
    if (!quoted && char === "[") attributeDepth += 1;
    if (!quoted && char === "]") attributeDepth = Math.max(0, attributeDepth - 1);

    if (!quoted && attributeDepth === 0 && (char === "{" || char === "}")) {
      if (char === "{") {
        buffer += char;
        flush();
      } else {
        flush();
        statements.push({ text: "}", line });
      }
      continue;
    }
    if (!quoted && attributeDepth === 0 && char === ";") {
      buffer += char;
      flush();
      continue;
    }
    if (char === "\n") {
      if (!quoted && attributeDepth === 0) flush();
      else buffer += char;
      line += 1;
      if (buffer === "") startLine = line;
      continue;
    }
    buffer += char;
  }
  flush();
  return statements;
}

const DOT_ID = String.raw`(?:"(?:\\.|[^"\\])*"|[A-Za-z0-9_.:-]+)`;
const HEADER_RE = new RegExp(
  String.raw`^(?:strict\s+)?(digraph|graph)(?:\s+(${DOT_ID}))?\s*\{$`,
  "i",
);
const SUBGRAPH_RE = new RegExp(String.raw`^subgraph(?:\s+(${DOT_ID}))?\s*\{$`, "i");
const EDGE_RE = new RegExp(
  String.raw`^(${DOT_ID})\s*(->|--)\s*(${DOT_ID})\s*(?:\[([\s\S]*)\])?\s*;?$`,
);
const NODE_RE = new RegExp(String.raw`^(${DOT_ID})\s*(?:\[([\s\S]*)\])?\s*;?$`);

function unquoteDot(raw: string): string {
  const value = raw.trim();
  if (!value.startsWith('"') || !value.endsWith('"')) return value;
  return value
    .slice(1, -1)
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function splitDotAttributes(raw: string): string[] {
  const out: string[] = [];
  let buffer = "";
  let quoted = false;
  let escaped = false;
  for (const char of raw) {
    if (escaped) {
      buffer += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      buffer += char;
      escaped = true;
      continue;
    }
    if (char === '"') quoted = !quoted;
    if (!quoted && (char === "," || char === ";")) {
      if (buffer.trim() !== "") out.push(buffer.trim());
      buffer = "";
      continue;
    }
    buffer += char;
  }
  if (buffer.trim() !== "") out.push(buffer.trim());
  return out;
}

function parseDotAttributes(raw: string | undefined): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (raw === undefined) return attrs;
  for (const part of splitDotAttributes(raw)) {
    const match = /^([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*([\s\S]+)$/.exec(part);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      attrs[match[1]] = unquoteDot(match[2]);
    }
  }
  return attrs;
}

function parseJsonAttribute(raw: string): AttrValue {
  try {
    return JSON.parse(raw) as AttrValue;
  } catch {
    return raw;
  }
}

function customAttrs(attrs: Record<string, string>): Record<string, AttrValue> | undefined {
  const custom: Record<string, AttrValue> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (!key.startsWith("topox_attr_")) continue;
    const encoded = key.slice("topox_attr_".length);
    const name = encoded.startsWith("h")
      ? hexToUtf8(encoded.slice(1))
      : decodeURIComponent(encoded);
    if (name === undefined) continue;
    custom[name] = parseJsonAttribute(value);
  }
  return Object.keys(custom).length > 0 ? custom : undefined;
}

export function parseDot(text: string): DotParseResult {
  const statements = dotStatements(text);
  const header = statements.shift();
  const headerMatch = header === undefined ? null : HEADER_RE.exec(header.text);
  if (headerMatch === null) throw new Error("expected a DOT graph or digraph declaration");

  const directedByDefault = headerMatch[1]?.toLowerCase() === "digraph";
  const graphId = headerMatch[2] === undefined ? "dot-import" : unquoteDot(headerMatch[2]);
  const warnings: string[] = [];
  const nodes = new Map<string, Node>();
  const edges: Edge[] = [];
  const groups = new Map<string, Group>();
  const groupStack: Group[] = [];
  const parentOf = new Map<string, string>();
  const edgeIds = new Set<string>();
  let title: string | undefined;
  let rootClosed = false;
  let edgeSeq = 0;

  const addToCurrentGroup = (id: string) => {
    const group = groupStack.at(-1);
    if (group === undefined || group.children.includes(id)) return;
    const parent = parentOf.get(id);
    if (parent !== undefined && parent !== group.id) {
      warnings.push(`entity "${id}" appears in multiple clusters; kept in "${parent}"`);
      return;
    }
    group.children.push(id);
    parentOf.set(id, group.id);
  };
  const ensureNode = (id: string): Node => {
    let node = nodes.get(id);
    if (node === undefined) {
      node = { id, type: "default", label: id };
      nodes.set(id, node);
    }
    addToCurrentGroup(id);
    return node;
  };

  for (const statement of statements) {
    const line = statement.text;
    if (line === "}") {
      if (groupStack.length > 0) groupStack.pop();
      else if (!rootClosed) rootClosed = true;
      else warnings.push(`line ${statement.line}: unmatched "}"`);
      continue;
    }
    if (rootClosed) {
      warnings.push(`line ${statement.line}: content after graph close skipped`);
      continue;
    }

    const subgraph = SUBGRAPH_RE.exec(line);
    if (subgraph !== null) {
      const rawId = subgraph[1] === undefined ? `group-${groups.size + 1}` : unquoteDot(subgraph[1]);
      const id = rawId.startsWith("cluster_")
        ? decodeURIComponent(rawId.slice("cluster_".length))
        : rawId;
      let group = groups.get(id);
      if (group === undefined) {
        group = { id, label: id, children: [] };
        groups.set(id, group);
        addToCurrentGroup(id);
      }
      groupStack.push(group);
      continue;
    }

    const defaults = /^(graph|node|edge)\s*\[([\s\S]*)\]\s*;?$/i.exec(line);
    if (defaults !== null) {
      if (defaults[1]?.toLowerCase() === "graph") {
        const attrs = parseDotAttributes(defaults[2]);
        if (attrs["label"] !== undefined) title = attrs["label"];
      }
      continue;
    }

    const assignment = /^([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*([\s\S]+?)\s*;?$/.exec(line);
    if (assignment !== null) {
      const key = assignment[1]!;
      const value = unquoteDot(assignment[2]!);
      const currentGroup = groupStack.at(-1);
      if (key === "label" && currentGroup !== undefined) currentGroup.label = value;
      else if (key === "label") title = value;
      continue;
    }

    const edgeMatch = EDGE_RE.exec(line);
    if (edgeMatch !== null) {
      const source = unquoteDot(edgeMatch[1]!);
      const operator = edgeMatch[2]!;
      const target = unquoteDot(edgeMatch[3]!);
      const attrs = parseDotAttributes(edgeMatch[4]);
      ensureNode(source);
      ensureNode(target);
      let id = attrs["id"] ?? `e${++edgeSeq}`;
      while (edgeIds.has(id)) id = `${id}_`;
      edgeIds.add(id);
      const directed =
        attrs["topox_directed"] === "false" || attrs["dir"] === "none"
          ? false
          : attrs["topox_directed"] === "true" || operator === "->" || directedByDefault;
      const arrow =
        attrs["dir"] === "back" ? "backward" : attrs["dir"] === "both" ? "both" : undefined;
      const edge: Edge = {
        id,
        source,
        target,
        ...(directed ? { directed: true } : {}),
        ...(directed && arrow !== undefined ? { arrow } : {}),
        ...(attrs["label"] !== undefined ? { label: attrs["label"] } : {}),
        ...(attrs["topox_type"] !== undefined ? { type: attrs["topox_type"] } : {}),
      };
      const attrsBag = customAttrs(attrs);
      if (attrsBag !== undefined) edge.attrs = attrsBag;
      edges.push(edge);
      continue;
    }

    const nodeMatch = NODE_RE.exec(line);
    if (nodeMatch !== null) {
      const id = unquoteDot(nodeMatch[1]!);
      const attrs = parseDotAttributes(nodeMatch[2]);
      const node = ensureNode(id);
      if (attrs["label"] !== undefined) node.label = attrs["label"];
      if (attrs["topox_type"] !== undefined) node.type = attrs["topox_type"];
      if (attrs["topox_ref"] !== undefined) node.ref = attrs["topox_ref"];
      if (attrs["topox_description"] !== undefined) {
        node.description = attrs["topox_description"];
      }
      if (attrs["topox_icon"] !== undefined) node.icon = attrs["topox_icon"];
      if (attrs["topox_style"] !== undefined) {
        const style = parseNodeStyleAttribute(attrs["topox_style"]);
        if (style !== undefined) node.style = style;
      }
      if (attrs["topox_tags"] !== undefined) {
        const tags = parseJsonAttribute(attrs["topox_tags"]);
        if (Array.isArray(tags) && tags.every((tag) => typeof tag === "string")) {
          node.tags = tags;
        }
      }
      if (attrs["topox_locked"] === "true") node.locked = true;
      const attrsBag = customAttrs(attrs);
      if (attrsBag !== undefined) node.attrs = attrsBag;
      continue;
    }

    warnings.push(`line ${statement.line}: skipped unsupported DOT statement: ${line}`);
  }

  if (!rootClosed) throw new Error("unclosed DOT graph");
  const doc = emptyDoc(graphId, title);
  doc.graph.nodes = [...nodes.values()];
  doc.graph.edges = edges;
  doc.graph.groups = [...groups.values()];
  return { doc, warnings };
}
