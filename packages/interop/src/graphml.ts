/**
 * GraphML interop.
 *
 * Groups use standard nested `<graph>` elements inside group `<node>` elements.
 * TopoX-specific metadata is carried through ordinary `<key>/<data>` values;
 * unknown namespaced extension payloads are ignored on import.
 */
import { DOMParser, type Element as XmlElement, type Node as XmlNode } from "@xmldom/xmldom";
import type { AttrValue, Edge, Group, Node, NodeLayout, TopoDoc } from "@topox/core";
import { emptyDoc } from "@topox/core";
import { utf8ToHex } from "./encoding.js";

export interface GraphMLParseResult {
  doc: TopoDoc;
  warnings: string[];
}

type GraphMLScope = "graph" | "node" | "edge";
type TopoXScope = "graph" | "node" | "group" | "edge";

interface GraphMLKey {
  id: string;
  scope: GraphMLScope;
  name: string;
  type: string;
  topoxScope?: TopoXScope;
  encoding?: "json";
}

const K = {
  graphId: "topox_graph_id",
  graphName: "topox_graph_name",
  graphDescription: "topox_graph_description",
  nodeId: "topox_node_id",
  nodeLabel: "topox_node_label",
  nodeType: "topox_node_type",
  nodeDescription: "topox_node_description",
  nodeIcon: "topox_node_icon",
  nodeRef: "topox_node_ref",
  nodeTags: "topox_node_tags",
  nodeLocked: "topox_node_locked",
  nodeX: "topox_node_x",
  nodeY: "topox_node_y",
  nodeWidth: "topox_node_width",
  nodeHeight: "topox_node_height",
  groupId: "topox_group_id",
  groupLabel: "topox_group_label",
  groupCollapsed: "topox_group_collapsed",
  edgeId: "topox_edge_id",
  edgeLabel: "topox_edge_label",
  edgeType: "topox_edge_type",
  edgeColor: "topox_edge_color",
  edgeWeight: "topox_edge_weight",
} as const;

const FIXED_KEYS: GraphMLKey[] = [
  { id: K.graphId, scope: "graph", name: "id", type: "string", topoxScope: "graph" },
  { id: K.graphName, scope: "graph", name: "name", type: "string", topoxScope: "graph" },
  {
    id: K.graphDescription,
    scope: "graph",
    name: "description",
    type: "string",
    topoxScope: "graph",
  },
  { id: K.nodeId, scope: "node", name: "id", type: "string", topoxScope: "node" },
  { id: K.nodeLabel, scope: "node", name: "label", type: "string", topoxScope: "node" },
  { id: K.nodeType, scope: "node", name: "type", type: "string", topoxScope: "node" },
  {
    id: K.nodeDescription,
    scope: "node",
    name: "description",
    type: "string",
    topoxScope: "node",
  },
  { id: K.nodeIcon, scope: "node", name: "icon", type: "string", topoxScope: "node" },
  { id: K.nodeRef, scope: "node", name: "ref", type: "string", topoxScope: "node" },
  {
    id: K.nodeTags,
    scope: "node",
    name: "tags",
    type: "string",
    topoxScope: "node",
    encoding: "json",
  },
  {
    id: K.nodeLocked,
    scope: "node",
    name: "locked",
    type: "boolean",
    topoxScope: "node",
  },
  { id: K.nodeX, scope: "node", name: "x", type: "double", topoxScope: "node" },
  { id: K.nodeY, scope: "node", name: "y", type: "double", topoxScope: "node" },
  { id: K.nodeWidth, scope: "node", name: "width", type: "double", topoxScope: "node" },
  { id: K.nodeHeight, scope: "node", name: "height", type: "double", topoxScope: "node" },
  { id: K.groupId, scope: "node", name: "id", type: "string", topoxScope: "group" },
  {
    id: K.groupLabel,
    scope: "node",
    name: "label",
    type: "string",
    topoxScope: "group",
  },
  {
    id: K.groupCollapsed,
    scope: "node",
    name: "collapsed",
    type: "boolean",
    topoxScope: "group",
  },
  { id: K.edgeId, scope: "edge", name: "id", type: "string", topoxScope: "edge" },
  { id: K.edgeLabel, scope: "edge", name: "label", type: "string", topoxScope: "edge" },
  { id: K.edgeType, scope: "edge", name: "type", type: "string", topoxScope: "edge" },
  { id: K.edgeColor, scope: "edge", name: "color", type: "string", topoxScope: "edge" },
  {
    id: K.edgeWeight,
    scope: "edge",
    name: "weight",
    type: "double",
    topoxScope: "edge",
  },
];
const FIXED_KEY_IDS = new Set(FIXED_KEYS.map((key) => key.id));

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function graphXmlId(id: string): string {
  return `topox_graph_${utf8ToHex(id)}`;
}

function nodeXmlId(id: string): string {
  return `topox_node_${utf8ToHex(id)}`;
}

function groupXmlId(id: string): string {
  return `topox_group_${utf8ToHex(id)}`;
}

function edgeXmlId(id: string): string {
  return `topox_edge_${utf8ToHex(id)}`;
}

function customKeys(
  scope: TopoXScope,
  graphmlScope: GraphMLScope,
  attrs: (Record<string, AttrValue> | undefined)[],
): { keys: GraphMLKey[]; byName: Map<string, string> } {
  const names = [...new Set(attrs.flatMap((bag) => Object.keys(bag ?? {})))].sort();
  const byName = new Map<string, string>();
  const keys = names.map((name, index): GraphMLKey => {
    const id = `topox_${scope}_attr_${index + 1}`;
    byName.set(name, id);
    return {
      id,
      scope: graphmlScope,
      name,
      type: "string",
      topoxScope: scope,
      encoding: "json",
    };
  });
  return { keys, byName };
}

function keyLine(key: GraphMLKey): string {
  return `  <key id="${escapeXml(key.id)}" for="${key.scope}" attr.name="${escapeXml(
    key.name,
  )}" attr.type="${key.type}"${
    key.topoxScope !== undefined ? ` topox:scope="${key.topoxScope}"` : ""
  }${key.encoding !== undefined ? ` topox:encoding="${key.encoding}"` : ""}/>`;
}

function dataLine(indent: string, key: string, value: string): string {
  return `${indent}<data key="${escapeXml(key)}">${escapeXml(value)}</data>`;
}

function customDataLines(
  indent: string,
  attrs: Record<string, AttrValue> | undefined,
  keys: ReadonlyMap<string, string>,
): string[] {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(attrs ?? {})) {
    const key = keys.get(name);
    if (key !== undefined) lines.push(dataLine(indent, key, JSON.stringify(value)));
  }
  return lines;
}

export function toGraphML(doc: TopoDoc): string {
  const { graph } = doc;
  const view = doc.views[0];
  const graphCustom = customKeys("graph", "graph", [graph.meta?.attrs]);
  const nodeCustom = customKeys(
    "node",
    "node",
    graph.nodes.map((node) => node.attrs),
  );
  const groupCustom = customKeys(
    "group",
    "node",
    graph.groups.map((group) => group.attrs),
  );
  const edgeCustom = customKeys(
    "edge",
    "edge",
    graph.edges.map((edge) => edge.attrs),
  );
  const allKeys = [
    ...FIXED_KEYS,
    ...graphCustom.keys,
    ...nodeCustom.keys,
    ...groupCustom.keys,
    ...edgeCustom.keys,
  ];
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns"',
    '         xmlns:topox="https://topox.dev/xmlns/1">',
    ...allKeys.map(keyLine),
    `  <graph id="${escapeXml(graphXmlId(graph.id))}" edgedefault="directed">`,
    dataLine("    ", K.graphId, graph.id),
  ];
  if (graph.meta?.name !== undefined) {
    lines.push(dataLine("    ", K.graphName, graph.meta.name));
  }
  if (graph.meta?.description !== undefined) {
    lines.push(dataLine("    ", K.graphDescription, graph.meta.description));
  }
  lines.push(...customDataLines("    ", graph.meta?.attrs, graphCustom.byName));

  const groups = new Map(graph.groups.map((group) => [group.id, group]));
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const parentOf = new Map<string, string>();
  for (const group of graph.groups) {
    for (const child of group.children) parentOf.set(child, group.id);
  }

  const emitNode = (node: Node, indent: string) => {
    lines.push(`${indent}<node id="${escapeXml(nodeXmlId(node.id))}">`);
    lines.push(dataLine(`${indent}  `, K.nodeId, node.id));
    lines.push(dataLine(`${indent}  `, K.nodeLabel, node.label));
    lines.push(dataLine(`${indent}  `, K.nodeType, node.type));
    if (node.description !== undefined) {
      lines.push(dataLine(`${indent}  `, K.nodeDescription, node.description));
    }
    if (node.icon !== undefined) lines.push(dataLine(`${indent}  `, K.nodeIcon, node.icon));
    if (node.ref !== undefined) lines.push(dataLine(`${indent}  `, K.nodeRef, node.ref));
    if (node.tags !== undefined) {
      lines.push(dataLine(`${indent}  `, K.nodeTags, JSON.stringify(node.tags)));
    }
    if (node.locked === true) lines.push(dataLine(`${indent}  `, K.nodeLocked, "true"));
    const position = view?.layout[node.id];
    if (position !== undefined) {
      lines.push(dataLine(`${indent}  `, K.nodeX, String(position.x)));
      lines.push(dataLine(`${indent}  `, K.nodeY, String(position.y)));
      if (position.width !== undefined) {
        lines.push(dataLine(`${indent}  `, K.nodeWidth, String(position.width)));
      }
      if (position.height !== undefined) {
        lines.push(dataLine(`${indent}  `, K.nodeHeight, String(position.height)));
      }
    }
    lines.push(...customDataLines(`${indent}  `, node.attrs, nodeCustom.byName));
    lines.push(`${indent}</node>`);
  };
  const emitGroup = (group: Group, indent: string) => {
    const xmlId = groupXmlId(group.id);
    lines.push(`${indent}<node id="${escapeXml(xmlId)}">`);
    lines.push(dataLine(`${indent}  `, K.groupId, group.id));
    lines.push(dataLine(`${indent}  `, K.groupLabel, group.label));
    if (group.collapsed === true) {
      lines.push(dataLine(`${indent}  `, K.groupCollapsed, "true"));
    }
    lines.push(...customDataLines(`${indent}  `, group.attrs, groupCustom.byName));
    lines.push(`${indent}  <graph id="${escapeXml(`${xmlId}_graph`)}" edgedefault="directed">`);
    for (const childId of group.children) {
      const childGroup = groups.get(childId);
      if (childGroup !== undefined) {
        emitGroup(childGroup, `${indent}    `);
        continue;
      }
      const node = nodes.get(childId);
      if (node !== undefined) emitNode(node, `${indent}    `);
    }
    lines.push(`${indent}  </graph>`);
    lines.push(`${indent}</node>`);
  };

  for (const group of graph.groups) {
    if (!parentOf.has(group.id)) emitGroup(group, "    ");
  }
  for (const node of graph.nodes) {
    if (!parentOf.has(node.id)) emitNode(node, "    ");
  }

  for (const edge of graph.edges) {
    lines.push(
      `    <edge id="${escapeXml(edgeXmlId(edge.id))}" source="${escapeXml(
        nodeXmlId(edge.source),
      )}" target="${escapeXml(nodeXmlId(edge.target))}" directed="${
        edge.directed === true ? "true" : "false"
      }">`,
    );
    lines.push(dataLine("      ", K.edgeId, edge.id));
    if (edge.label !== undefined) lines.push(dataLine("      ", K.edgeLabel, edge.label));
    if (edge.type !== undefined) lines.push(dataLine("      ", K.edgeType, edge.type));
    if (edge.color !== undefined) lines.push(dataLine("      ", K.edgeColor, edge.color));
    if (edge.weight !== undefined) {
      lines.push(dataLine("      ", K.edgeWeight, String(edge.weight)));
    }
    lines.push(...customDataLines("      ", edge.attrs, edgeCustom.byName));
    lines.push("    </edge>");
  }
  lines.push("  </graph>", "</graphml>");
  return `${lines.join("\n")}\n`;
}

function elementName(element: XmlElement): string {
  return element.localName ?? element.nodeName.split(":").at(-1) ?? element.nodeName;
}

function childElements(parent: XmlNode, name?: string): XmlElement[] {
  const children: XmlElement[] = [];
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const node = parent.childNodes.item(index);
    if (node?.nodeType !== 1) continue;
    const element = node as XmlElement;
    if (name === undefined || elementName(element) === name) children.push(element);
  }
  return children;
}

function attribute(element: XmlElement, name: string): string | undefined {
  return element.hasAttribute(name) ? (element.getAttribute(name) ?? "") : undefined;
}

interface ParsedKey extends GraphMLKey {}

interface DataEntry {
  key: ParsedKey;
  value: string;
}

function dataEntries(element: XmlElement, keys: ReadonlyMap<string, ParsedKey>): DataEntry[] {
  const entries: DataEntry[] = [];
  for (const data of childElements(element, "data")) {
    const id = attribute(data, "key");
    const key = id === undefined ? undefined : keys.get(id);
    if (key === undefined || childElements(data).length > 0) continue;
    entries.push({ key, value: data.textContent ?? "" });
  }
  return entries;
}

function dataValue(entries: readonly DataEntry[], id: string, externalName?: string): string | undefined {
  const exact = entries.find((entry) => entry.key.id === id);
  if (exact !== undefined) return exact.value;
  if (externalName === undefined) return undefined;
  return entries.find((entry) => entry.key.name === externalName)?.value;
}

function parsedAttrValue(entry: DataEntry): AttrValue {
  if (entry.key.encoding === "json") {
    try {
      return JSON.parse(entry.value) as AttrValue;
    } catch {
      return entry.value;
    }
  }
  if (entry.key.type === "boolean") return entry.value.trim().toLowerCase() === "true";
  if (["int", "long", "float", "double"].includes(entry.key.type)) {
    const numeric = Number(entry.value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return entry.value;
}

function parsedCustomAttrs(
  entries: readonly DataEntry[],
  scope: TopoXScope,
): Record<string, AttrValue> | undefined {
  const externalModelFields: Record<TopoXScope, ReadonlySet<string>> = {
    graph: new Set(["id", "name", "description"]),
    node: new Set([
      "id",
      "label",
      "type",
      "description",
      "icon",
      "ref",
      "tags",
      "locked",
      "x",
      "y",
      "width",
      "height",
    ]),
    group: new Set(["id", "label", "collapsed"]),
    edge: new Set(["id", "label", "type", "color", "weight"]),
  };
  const attrs: Record<string, AttrValue> = {};
  for (const entry of entries) {
    if (
      FIXED_KEY_IDS.has(entry.key.id) ||
      entry.key.name === "" ||
      (entry.key.topoxScope === undefined && externalModelFields[scope].has(entry.key.name)) ||
      (entry.key.topoxScope !== undefined && entry.key.topoxScope !== scope)
    ) {
      continue;
    }
    attrs[entry.key.name] = parsedAttrValue(entry);
  }
  return Object.keys(attrs).length > 0 ? attrs : undefined;
}

function decodedXmlId(xmlId: string, prefix: string): string {
  return xmlId.startsWith(prefix) ? decodeURIComponent(xmlId.slice(prefix.length)) : xmlId;
}

function finiteNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

interface GraphContext {
  element: XmlElement;
  directedByDefault: boolean;
}

export function parseGraphML(text: string): GraphMLParseResult {
  let xml;
  try {
    xml = new DOMParser({
      onError: (_level, message) => {
        throw new Error(message);
      },
    }).parseFromString(text, "application/xml");
  } catch (error) {
    throw new Error(`invalid GraphML XML: ${error instanceof Error ? error.message : String(error)}`);
  }
  const root = xml.documentElement;
  if (root === null || elementName(root) !== "graphml") {
    throw new Error("expected a GraphML <graphml> document");
  }

  const keys = new Map<string, ParsedKey>();
  for (const keyElement of childElements(root, "key")) {
    const id = attribute(keyElement, "id");
    const scope = attribute(keyElement, "for");
    if (
      id === undefined ||
      (scope !== "graph" && scope !== "node" && scope !== "edge")
    ) {
      continue;
    }
    keys.set(id, {
      id,
      scope,
      name: attribute(keyElement, "attr.name") ?? "",
      type: attribute(keyElement, "attr.type") ?? "string",
      ...(attribute(keyElement, "topox:scope") !== undefined
        ? { topoxScope: attribute(keyElement, "topox:scope") as TopoXScope }
        : {}),
      ...(attribute(keyElement, "topox:encoding") === "json" ? { encoding: "json" } : {}),
    });
  }

  const rootGraph = childElements(root, "graph")[0];
  if (rootGraph === undefined) throw new Error("GraphML document has no root <graph>");
  const rootData = dataEntries(rootGraph, keys);
  const rawGraphId =
    dataValue(rootData, K.graphId) ??
    decodedXmlId(attribute(rootGraph, "id") ?? "graphml-import", "graph:");
  const graphName = dataValue(rootData, K.graphName, "name");
  const doc = emptyDoc(rawGraphId, graphName);
  const description = dataValue(rootData, K.graphDescription, "description");
  if (description !== undefined) {
    doc.graph.meta = { ...(doc.graph.meta ?? {}), description };
  }
  const graphAttrs = parsedCustomAttrs(rootData, "graph");
  if (graphAttrs !== undefined) {
    doc.graph.meta = { ...(doc.graph.meta ?? {}), attrs: graphAttrs };
  }

  const warnings: string[] = [];
  const nodes: Node[] = [];
  const groups: Group[] = [];
  const layout: Record<string, NodeLayout> = {};
  const xmlEntities = new Map<string, { kind: "node" | "group"; id: string }>();
  const contexts: GraphContext[] = [];

  const parseNodes = (graphElement: XmlElement, parentGroup?: Group) => {
    contexts.push({
      element: graphElement,
      directedByDefault: attribute(graphElement, "edgedefault") !== "undirected",
    });
    for (const nodeElement of childElements(graphElement, "node")) {
      const xmlId = attribute(nodeElement, "id");
      if (xmlId === undefined || xmlId === "") {
        warnings.push("GraphML node without id skipped");
        continue;
      }
      const entries = dataEntries(nodeElement, keys);
      const nestedGraph = childElements(nodeElement, "graph")[0];
      if (nestedGraph !== undefined) {
        const id = dataValue(entries, K.groupId) ?? decodedXmlId(xmlId, "group:");
        const group: Group = {
          id,
          label: dataValue(entries, K.groupLabel, "label") ?? id,
          children: [],
          ...(dataValue(entries, K.groupCollapsed) === "true" ? { collapsed: true } : {}),
        };
        const attrs = parsedCustomAttrs(entries, "group");
        if (attrs !== undefined) group.attrs = attrs;
        groups.push(group);
        xmlEntities.set(xmlId, { kind: "group", id });
        if (parentGroup !== undefined) parentGroup.children.push(id);
        parseNodes(nestedGraph, group);
        continue;
      }

      const id = dataValue(entries, K.nodeId) ?? decodedXmlId(xmlId, "node:");
      const node: Node = {
        id,
        label: dataValue(entries, K.nodeLabel, "label") ?? id,
        type: dataValue(entries, K.nodeType, "type") ?? "default",
      };
      const descriptionValue = dataValue(entries, K.nodeDescription, "description");
      if (descriptionValue !== undefined) node.description = descriptionValue;
      const icon = dataValue(entries, K.nodeIcon, "icon");
      if (icon !== undefined) node.icon = icon;
      const ref = dataValue(entries, K.nodeRef, "ref");
      if (ref !== undefined) node.ref = ref;
      const tags = dataValue(entries, K.nodeTags, "tags");
      if (tags !== undefined) {
        try {
          const parsed: unknown = JSON.parse(tags);
          if (Array.isArray(parsed) && parsed.every((tag) => typeof tag === "string")) {
            node.tags = parsed;
          }
        } catch {
          warnings.push(`GraphML node "${id}" has invalid tags data`);
        }
      }
      if (dataValue(entries, K.nodeLocked, "locked") === "true") node.locked = true;
      const attrs = parsedCustomAttrs(entries, "node");
      if (attrs !== undefined) node.attrs = attrs;
      nodes.push(node);
      xmlEntities.set(xmlId, { kind: "node", id });
      if (parentGroup !== undefined) parentGroup.children.push(id);

      const x = finiteNumber(dataValue(entries, K.nodeX, "x"));
      const y = finiteNumber(dataValue(entries, K.nodeY, "y"));
      if (x !== undefined && y !== undefined) {
        const width = finiteNumber(dataValue(entries, K.nodeWidth, "width"));
        const height = finiteNumber(dataValue(entries, K.nodeHeight, "height"));
        layout[id] = {
          x,
          y,
          ...(width !== undefined ? { width } : {}),
          ...(height !== undefined ? { height } : {}),
        };
      }
    }
  };
  parseNodes(rootGraph);

  const edges: Edge[] = [];
  const edgeIds = new Set<string>();
  let edgeSeq = 0;
  for (const context of contexts) {
    for (const edgeElement of childElements(context.element, "edge")) {
      const sourceXml = attribute(edgeElement, "source");
      const targetXml = attribute(edgeElement, "target");
      const source = sourceXml === undefined ? undefined : xmlEntities.get(sourceXml);
      const target = targetXml === undefined ? undefined : xmlEntities.get(targetXml);
      if (
        source === undefined ||
        target === undefined ||
        source.kind !== "node" ||
        target.kind !== "node"
      ) {
        warnings.push(
          `GraphML edge "${attribute(edgeElement, "id") ?? "?"}" has an unknown or grouped endpoint`,
        );
        continue;
      }
      const entries = dataEntries(edgeElement, keys);
      let id =
        dataValue(entries, K.edgeId) ??
        decodedXmlId(attribute(edgeElement, "id") ?? `e${++edgeSeq}`, "edge:");
      while (edgeIds.has(id)) id = `${id}_`;
      edgeIds.add(id);
      const directedAttr = attribute(edgeElement, "directed");
      const directed =
        directedAttr === "true"
          ? true
          : directedAttr === "false"
            ? false
            : context.directedByDefault;
      const edge: Edge = {
        id,
        source: source.id,
        target: target.id,
        ...(directed ? { directed: true } : {}),
      };
      const label = dataValue(entries, K.edgeLabel, "label");
      if (label !== undefined) edge.label = label;
      const type = dataValue(entries, K.edgeType, "type");
      if (type !== undefined) edge.type = type;
      const color = dataValue(entries, K.edgeColor, "color");
      if (color !== undefined) edge.color = color;
      const weight = finiteNumber(dataValue(entries, K.edgeWeight, "weight"));
      if (weight !== undefined) edge.weight = weight;
      const attrs = parsedCustomAttrs(entries, "edge");
      if (attrs !== undefined) edge.attrs = attrs;
      edges.push(edge);
    }
  }

  doc.graph.nodes = nodes;
  doc.graph.edges = edges;
  doc.graph.groups = groups;
  doc.views[0]!.layout = layout;
  return { doc, warnings };
}
