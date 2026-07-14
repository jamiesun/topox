/**
 * Mermaid interop.
 *
 * Export: TopoDoc -> `flowchart` text. Groups become subgraphs (nested),
 * node types become `:::class` annotations, undirected edges use `---`.
 * Layout, descriptions, tags and attrs do not exist in Mermaid — export is
 * intentionally lossy; Mermaid is an exchange/rendering format, not storage.
 *
 * Import: tolerant parser for the common flowchart subset (the kind LLMs and
 * humans actually write). Unknown lines produce warnings, never hard failures —
 * same philosophy as the DSL compiler. Nodes referenced but never defined are
 * created on the fly, exactly like Mermaid itself does.
 */
import type { Edge, Group, Node, TopoDoc } from "@topox/core";
import { emptyDoc } from "@topox/core";

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface MermaidExportOptions {
  /** flowchart direction, default "TD". */
  direction?: "TD" | "LR" | "BT" | "RL";
}

const SAFE_ID = /^[A-Za-z0-9_.-]+$/;

function escLabel(label: string): string {
  return label.replaceAll('"', "#quot;");
}

function escPipe(label: string): string {
  return escLabel(label).replaceAll("|", "/");
}

export function toMermaid(doc: TopoDoc, options: MermaidExportOptions = {}): string {
  const { graph } = doc;
  const lines: string[] = [];
  const warnings: string[] = [];

  // Mermaid ids cannot carry spaces/exotic chars; sanitize with a stable map.
  const idMap = new Map<string, string>();
  const used = new Set<string>();
  const mid = (id: string): string => {
    const hit = idMap.get(id);
    if (hit) return hit;
    let candidate = SAFE_ID.test(id) ? id : id.replace(/[^A-Za-z0-9_.-]/g, "_");
    while (used.has(candidate)) candidate = `${candidate}_`;
    used.add(candidate);
    idMap.set(id, candidate);
    if (candidate !== id) warnings.push(`id "${id}" sanitized to "${candidate}"`);
    return candidate;
  };

  const title = graph.meta?.name;
  if (title !== undefined && title !== "") {
    lines.push("---", `title: ${title}`, "---");
  }
  lines.push(`flowchart ${options.direction ?? "TD"}`);

  const nodeLine = (n: Node): string =>
    `${mid(n.id)}["${escLabel(n.label)}"]${n.type !== "" ? `:::${n.type}` : ""}`;

  // innermost group membership for nodes and groups
  const parentOf = new Map<string, string>();
  for (const g of graph.groups) {
    for (const child of g.children) parentOf.set(child, g.id);
  }
  const groupById = new Map(graph.groups.map((g) => [g.id, g]));

  const emitGroup = (g: Group, indent: string): void => {
    lines.push(`${indent}subgraph ${mid(g.id)}["${escLabel(g.label)}"]`);
    for (const childId of g.children) {
      const childGroup = groupById.get(childId);
      if (childGroup) {
        emitGroup(childGroup, indent + "  ");
        continue;
      }
      const node = graph.nodes.find((n) => n.id === childId);
      if (node) lines.push(`${indent}  ${nodeLine(node)}`);
    }
    lines.push(`${indent}end`);
  };

  for (const g of graph.groups) {
    if (!parentOf.has(g.id)) emitGroup(g, "  ");
  }
  for (const n of graph.nodes) {
    if (!parentOf.has(n.id)) lines.push(`  ${nodeLine(n)}`);
  }

  for (const e of graph.edges) {
    // Mermaid has no reversed-only arrow syntax; "backward" degrades to a
    // plain forward arrow (lossy, same as other unsupported Mermaid gaps).
    const arrow = e.directed !== true ? "---" : e.arrow === "both" ? "<-->" : "-->";
    const label = e.label !== undefined && e.label !== "" ? `|${escPipe(e.label)}|` : "";
    lines.push(`  ${mid(e.source)} ${arrow}${label} ${mid(e.target)}`);
  }

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface MermaidParseResult {
  doc: TopoDoc;
  warnings: string[];
}

/** `id["label"]:::type`, `id(label)`, `id`, `id:::type`, ... */
const SHAPED_NODE =
  /^([A-Za-z0-9_.-]+)(\(\(|\(\[|\[\[|\[\(|\{\{|\[\/|\[\\|>|\[|\(|\{)(.*?)(\)\)|\]\)|\]\]|\)\]|\}\}|\/\]|\\\]|\]|\)|\})(?::::([A-Za-z0-9_-]+))?$/;
const BARE_NODE = /^([A-Za-z0-9_.-]+)(?::::([A-Za-z0-9_-]+))?$/;

/** splits an edge statement; captures: [arrow, pipeLabel?] */
const ARROW_SPLIT = /\s*(<?={2,}>|={3,}|<?-{2,}>|-{3,}|-\.+->|--[xo])\s*(?:\|([^|]*)\|\s*)?/;

const SUBGRAPH_RE =
  /^subgraph\s+(?:([A-Za-z0-9_.-]+)\s*\[\s*"?(.*?)"?\s*\]|"(.*?)"|([A-Za-z0-9_.-]+)|(.+))\s*$/;

function unescLabel(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) s = s.slice(1, -1);
  return s.replaceAll("#quot;", '"').replaceAll("&quot;", '"').trim();
}

export function parseMermaid(text: string): MermaidParseResult {
  const warnings: string[] = [];
  const nodes = new Map<string, Node>();
  const edges: Edge[] = [];
  const groups = new Map<string, Group>();
  const groupStack: Group[] = [];
  let title: string | undefined;
  let edgeSeq = 0;

  const ensureNode = (id: string): Node => {
    let node = nodes.get(id);
    if (!node) {
      node = { id, type: "default", label: id };
      nodes.set(id, node);
      const top = groupStack[groupStack.length - 1];
      if (top && !top.children.includes(id)) top.children.push(id);
    }
    return node;
  };

  /** Parse one node token; returns node id or null. */
  const parseNodeToken = (rawToken: string): string | null => {
    const token = rawToken.trim().replace(/;+$/, "");
    if (token === "") return null;
    const shaped = SHAPED_NODE.exec(token);
    if (shaped) {
      const [, id, , body, , cls] = shaped;
      if (id === undefined) return null;
      const node = ensureNode(id);
      const label = unescLabel(body ?? "");
      if (label !== "") node.label = label;
      if (cls !== undefined) node.type = cls;
      return id;
    }
    const bare = BARE_NODE.exec(token);
    if (bare) {
      const [, id, cls] = bare;
      if (id === undefined) return null;
      const node = ensureNode(id);
      if (cls !== undefined) node.type = cls;
      return id;
    }
    return null;
  };

  const rawLines = text.split(/\r?\n/);
  let i = 0;

  // optional YAML frontmatter (--- title: X ---)
  while (i < rawLines.length && rawLines[i]?.trim() === "") i++;
  if (rawLines[i]?.trim() === "---") {
    i++;
    for (; i < rawLines.length && rawLines[i]?.trim() !== "---"; i++) {
      const m = /^title:\s*(.+)$/.exec(rawLines[i]?.trim() ?? "");
      const value = m?.[1];
      if (value !== undefined) title = unescLabel(value);
    }
    i++; // closing ---
  }

  for (; i < rawLines.length; i++) {
    let line = (rawLines[i] ?? "").replace(/%%.*$/, "").trim();
    if (line === "") continue;

    if (/^(flowchart|graph)\b/.test(line)) continue;
    if (/^direction\b/.test(line)) continue;
    if (/^(classDef|linkStyle|style|click|accTitle|accDescr)\b/.test(line)) continue;

    if (line === "end") {
      if (groupStack.length === 0) warnings.push(`line ${i + 1}: unmatched "end"`);
      else groupStack.pop();
      continue;
    }

    const sub = SUBGRAPH_RE.exec(line);
    if (line.startsWith("subgraph")) {
      const [, idA, labelA, quoted, bareId, freeform] = sub ?? [];
      let gid: string;
      let glabel: string;
      if (idA !== undefined) {
        gid = idA;
        glabel = unescLabel(labelA ?? idA);
      } else if (quoted !== undefined || freeform !== undefined) {
        glabel = unescLabel(quoted ?? freeform ?? "group");
        gid = glabel.replace(/[^A-Za-z0-9_.-]/g, "_");
      } else if (bareId !== undefined) {
        gid = bareId;
        glabel = bareId;
      } else {
        warnings.push(`line ${i + 1}: unreadable subgraph declaration`);
        continue;
      }
      let group = groups.get(gid);
      if (!group) {
        group = { id: gid, label: glabel, children: [] };
        groups.set(gid, group);
        const parent = groupStack[groupStack.length - 1];
        if (parent && !parent.children.includes(gid)) parent.children.push(gid);
      }
      groupStack.push(group);
      continue;
    }

    const classAssign = /^class\s+([A-Za-z0-9_.,\s-]+)\s+([A-Za-z0-9_-]+);?$/.exec(line);
    if (classAssign) {
      const [, ids, cls] = classAssign;
      if (ids !== undefined && cls !== undefined) {
        for (const id of ids.split(",").map((s) => s.trim()).filter(Boolean)) {
          ensureNode(id).type = cls;
        }
      }
      continue;
    }

    // normalize `a -- label --> b` and `a -. label .-> b` into `a -->|label| b`
    line = line
      .replace(/--\s+([^-|>][^-]*?)\s+-->/g, "-->|$1|")
      .replace(/--\s+([^-|>][^-]*?)\s+---/g, "---|$1|")
      .replace(/-\.\s+(.*?)\s+\.->/g, "-.->|$1|")
      .replace(/==\s+(.*?)\s+==>/g, "==>|$1|");

    const parts = line.split(ARROW_SPLIT);
    if (parts.length === 1) {
      // plain node definition line (possibly `a & b`)
      const ids = (parts[0] ?? "").split("&").map((t) => parseNodeToken(t));
      if (ids.some((id) => id === null)) {
        warnings.push(`line ${i + 1}: skipped: ${rawLines[i]?.trim() ?? ""}`);
      }
      continue;
    }

    // parts = [seg, arrow, label?, seg, arrow, label?, seg ...]
    let previous: string[] | null = null;
    let ok = true;
    for (let p = 0; p < parts.length; p += 3) {
      const seg = parts[p] ?? "";
      const segIds = seg
        .split("&")
        .map((t) => parseNodeToken(t))
        .filter((id): id is string => id !== null);
      if (segIds.length === 0) {
        ok = false;
        break;
      }
      if (previous) {
        const arrow = parts[p - 2] ?? "---";
        const label = parts[p - 1];
        const bidirectional = arrow.startsWith("<");
        const directed = bidirectional || arrow.includes(">");
        if (/--[xo]$/.test(arrow)) warnings.push(`line ${i + 1}: "${arrow}" end style dropped`);
        for (const s of previous) {
          for (const t of segIds) {
            edges.push({
              id: `e${++edgeSeq}`,
              source: s,
              target: t,
              ...(directed || /--[xo]$/.test(arrow) ? { directed: true } : {}),
              ...(bidirectional ? { arrow: "both" } : {}),
              ...(label !== undefined && label.trim() !== "" ? { label: unescLabel(label) } : {}),
            });
          }
        }
      }
      previous = segIds;
    }
    if (!ok) warnings.push(`line ${i + 1}: skipped: ${rawLines[i]?.trim() ?? ""}`);
  }

  if (groupStack.length > 0) warnings.push(`unclosed subgraph "${groupStack[groupStack.length - 1]?.id ?? "?"}"`);

  const doc = emptyDoc("mermaid-import", title);
  doc.graph.nodes = [...nodes.values()];
  doc.graph.edges = edges;
  doc.graph.groups = [...groups.values()];
  return { doc, warnings };
}
