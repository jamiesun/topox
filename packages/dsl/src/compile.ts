import type {
  AttrValue,
  DiffOp,
  Edge,
  GraphDiff,
  Group,
  Node,
  TopoDoc,
} from "@topox/core";
import { applyDiff, makeEdgeUpdate, makeGroupUpdate, makeNodeUpdate } from "@topox/core";
import { tokenize, type DslError, type Token } from "./tokenize.js";

export interface CompileResult {
  diff: GraphDiff;
  errors: DslError[];
}

const NODE_FIELDS = new Set(["type", "label", "ref", "icon", "desc", "description", "tags"]);
const EDGE_FIELDS = new Set(["id", "label", "color", "weight", "type"]);
const GROUP_FIELDS = new Set(["label", "children", "collapsed"]);

function parseScalar(raw: string, quoted: boolean): AttrValue {
  if (quoted) return raw;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (raw !== "" && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

interface KV {
  key: string;
  value: AttrValue;
  raw: string;
  quoted: boolean;
}

function splitKv(tokens: Token[]): { kvs: KV[]; positional: Token[] } {
  const kvs: KV[] = [];
  const positional: Token[] = [];
  for (const token of tokens) {
    const eq = token.quoted ? -1 : token.text.indexOf("=");
    if (eq > 0) {
      const key = token.text.slice(0, eq);
      const raw = token.text.slice(eq + 1);
      // A key=value token whose value came from quotes keeps string semantics
      // only when the raw text can't be reparsed as a scalar keyword/number.
      kvs.push({ key, value: parseScalar(raw, false), raw, quoted: false });
    } else {
      positional.push(token);
    }
  }
  return { kvs, positional };
}

function listValue(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function buildNode(id: string, label: string | undefined, kvs: KV[]): Node {
  const node: Node = { id, type: "default", label: label ?? id };
  const attrs: Record<string, AttrValue> = {};
  for (const { key, value, raw } of kvs) {
    switch (key) {
      case "type":
        node.type = String(value);
        break;
      case "label":
        node.label = String(value);
        break;
      case "ref":
        node.ref = String(value);
        break;
      case "icon":
        node.icon = String(value);
        break;
      case "desc":
      case "description":
        node.description = String(value);
        break;
      case "tags":
        node.tags = listValue(raw);
        break;
      default:
        attrs[key] = value;
    }
  }
  if (Object.keys(attrs).length > 0) node.attrs = attrs;
  return node;
}

function buildEdge(
  source: string,
  target: string,
  directed: boolean,
  label: string | undefined,
  kvs: KV[],
  usedIds: Set<string>,
): Edge {
  let id: string | undefined;
  const edge: Edge = { id: "", source, target };
  if (directed) edge.directed = true;
  if (label !== undefined) edge.label = label;
  const attrs: Record<string, AttrValue> = {};
  for (const { key, value } of kvs) {
    switch (key) {
      case "id":
        id = String(value);
        break;
      case "label":
        edge.label = String(value);
        break;
      case "color":
        edge.color = String(value);
        break;
      case "type":
        edge.type = String(value);
        break;
      case "weight":
        edge.weight = Number(value);
        break;
      default:
        attrs[key] = value;
    }
  }
  if (Object.keys(attrs).length > 0) edge.attrs = attrs;
  if (id === undefined) {
    id = `e-${source}-${target}`;
    let n = 2;
    while (usedIds.has(id)) id = `e-${source}-${target}-${(n += 1)}`;
  }
  edge.id = id;
  return edge;
}

function buildGroup(id: string, label: string | undefined, kvs: KV[]): Group {
  const group: Group = { id, label: label ?? id, children: [] };
  const attrs: Record<string, AttrValue> = {};
  for (const { key, value, raw } of kvs) {
    switch (key) {
      case "label":
        group.label = String(value);
        break;
      case "children":
        group.children = listValue(raw);
        break;
      case "collapsed":
        group.collapsed = value === true;
        break;
      default:
        attrs[key] = value;
    }
  }
  if (Object.keys(attrs).length > 0) group.attrs = attrs;
  return group;
}

/**
 * Compiles a DSL program into a GraphDiff against `doc`.
 *
 * Statements see the effects of earlier statements (a node created on line 1
 * can be wired on line 2). Failing lines are reported and skipped — an LLM's
 * one bad line doesn't poison the whole proposal.
 */
export function compileDsl(source: string, doc: TopoDoc): CompileResult {
  const errors: DslError[] = [];
  const ops: DiffOp[] = [];
  let working = doc;

  const push = (lineNo: number, line: string, candidate: DiffOp[]): void => {
    try {
      working = applyDiff(working, { ops: candidate });
      ops.push(...candidate);
    } catch (e) {
      errors.push({
        line: lineNo,
        message: e instanceof Error ? e.message : String(e),
        source: line,
      });
    }
  };

  const lines = source.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const lineNo = index + 1;
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) return;
    const tokens = tokenize(line);
    if (tokens.length === 0) return;
    const keyword = tokens[0]!.text.toLowerCase();

    const fail = (message: string) => errors.push({ line: lineNo, message, source: line });

    switch (keyword) {
      case "node": {
        const { kvs, positional } = splitKv(tokens.slice(1));
        const idToken = positional[0];
        if (!idToken || idToken.text === "") return fail("node: missing id");
        const label = positional[1]?.text;
        const id = idToken.text;
        const existing = working.graph.nodes.find((n) => n.id === id);
        if (existing) {
          const merged = buildNode(id, label ?? existing.label, kvs);
          // Upsert: keep existing fields that the statement doesn't mention.
          const next: Node = { ...existing, ...merged };
          if (!kvs.some((kv) => kv.key === "type")) next.type = existing.type;
          const op = makeNodeUpdate(existing, next);
          if (op) push(lineNo, line, [op]);
        } else {
          push(lineNo, line, [{ op: "add_node", node: buildNode(id, label, kvs) }]);
        }
        return;
      }
      case "edge": {
        const { kvs, positional } = splitKv(tokens.slice(1));
        const arrowIndex = positional.findIndex((t) => !t.quoted && (t.text === "->" || t.text === "--"));
        if (arrowIndex !== 1 || positional.length < 3) {
          return fail("edge: expected `edge <src> -> <dst>` or `edge <src> -- <dst>`");
        }
        const source_ = positional[0]!.text;
        const target = positional[2]!.text;
        const directed = positional[1]!.text === "->";
        const label = positional[3]?.text;
        const usedIds = new Set(working.graph.edges.map((e) => e.id));
        const edge = buildEdge(source_, target, directed, label, kvs, usedIds);
        const existing = working.graph.edges.find((e) => e.id === edge.id);
        if (existing) {
          const op = makeEdgeUpdate(existing, { ...existing, ...edge });
          if (op) push(lineNo, line, [op]);
        } else {
          push(lineNo, line, [{ op: "add_edge", edge }]);
        }
        return;
      }
      case "group": {
        const { kvs, positional } = splitKv(tokens.slice(1));
        const idToken = positional[0];
        if (!idToken) return fail("group: missing id");
        const label = positional[1]?.text;
        const id = idToken.text;
        const group = buildGroup(id, label, kvs);
        const existing = working.graph.groups.find((g) => g.id === id);
        if (existing) {
          const merged: Group = { ...existing, ...group };
          if (!kvs.some((kv) => kv.key === "children")) merged.children = existing.children;
          const op = makeGroupUpdate(existing, merged);
          if (op) push(lineNo, line, [op]);
        } else {
          push(lineNo, line, [{ op: "add_group", group }]);
        }
        return;
      }
      case "set": {
        const kind = tokens[1]?.text.toLowerCase();
        const id = tokens[2]?.text;
        if (!kind || !id) return fail("set: expected `set node|edge|group <id> key=value ...`");
        const { kvs } = splitKv(tokens.slice(3));
        if (kvs.length === 0) return fail("set: no key=value pairs");
        if (kind === "node") {
          const existing = working.graph.nodes.find((n) => n.id === id);
          if (!existing) return fail(`set node: unknown id ${id}`);
          const next = structuredClone(existing) as Node;
          const attrs = { ...(next.attrs ?? {}) };
          for (const { key, value, raw } of kvs) {
            if (NODE_FIELDS.has(key)) {
              if (key === "tags") next.tags = listValue(raw);
              else if (key === "desc" || key === "description") {
                if (value === null) delete next.description;
                else next.description = String(value);
              } else if (value === null) delete (next as unknown as Record<string, unknown>)[key];
              else (next as unknown as Record<string, unknown>)[key] = String(value);
            } else if (value === null) delete attrs[key];
            else attrs[key] = value;
          }
          if (Object.keys(attrs).length > 0) next.attrs = attrs;
          else delete next.attrs;
          const op = makeNodeUpdate(existing, next);
          if (op) push(lineNo, line, [op]);
        } else if (kind === "edge") {
          const existing = working.graph.edges.find((e) => e.id === id);
          if (!existing) return fail(`set edge: unknown id ${id}`);
          const next = structuredClone(existing) as Edge;
          const attrs = { ...(next.attrs ?? {}) };
          for (const { key, value } of kvs) {
            if (EDGE_FIELDS.has(key) && key !== "id") {
              if (value === null) delete (next as unknown as Record<string, unknown>)[key];
              else if (key === "weight") next.weight = Number(value);
              else (next as unknown as Record<string, unknown>)[key] = String(value);
            } else if (key === "directed") {
              if (value === true) next.directed = true;
              else delete next.directed;
            } else if (value === null) delete attrs[key];
            else attrs[key] = value;
          }
          if (Object.keys(attrs).length > 0) next.attrs = attrs;
          else delete next.attrs;
          const op = makeEdgeUpdate(existing, next);
          if (op) push(lineNo, line, [op]);
        } else if (kind === "group") {
          const existing = working.graph.groups.find((g) => g.id === id);
          if (!existing) return fail(`set group: unknown id ${id}`);
          const merged = buildGroup(id, undefined, kvs);
          const next: Group = { ...existing, ...merged, label: merged.label === id ? existing.label : merged.label };
          if (!kvs.some((kv) => kv.key === "children")) next.children = existing.children;
          const op = makeGroupUpdate(existing, next);
          if (op) push(lineNo, line, [op]);
        } else {
          fail(`set: unknown kind ${kind}`);
        }
        return;
      }
      case "remove": {
        const kind = tokens[1]?.text.toLowerCase();
        const id = tokens[2]?.text;
        if (!kind || !id) return fail("remove: expected `remove node|edge|group <id>`");
        if (kind === "node") {
          const node = working.graph.nodes.find((n) => n.id === id);
          if (!node) return fail(`remove node: unknown id ${id}`);
          const connected = working.graph.edges.filter((e) => e.source === id || e.target === id);
          push(lineNo, line, [
            ...connected.map((edge) => ({ op: "remove_edge" as const, edge })),
            { op: "remove_node", node },
          ]);
        } else if (kind === "edge") {
          const edge = working.graph.edges.find((e) => e.id === id);
          if (!edge) return fail(`remove edge: unknown id ${id}`);
          push(lineNo, line, [{ op: "remove_edge", edge }]);
        } else if (kind === "group") {
          const group = working.graph.groups.find((g) => g.id === id);
          if (!group) return fail(`remove group: unknown id ${id}`);
          push(lineNo, line, [{ op: "remove_group", group }]);
        } else {
          fail(`remove: unknown kind ${kind}`);
        }
        return;
      }
      default:
        fail(`unknown statement: ${keyword}`);
    }
  });

  return {
    diff: { origin: "dsl", summary: `dsl program (${ops.length} ops)`, ops },
    errors,
  };
}
