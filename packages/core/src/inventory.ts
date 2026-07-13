import type { Graph, Node } from "./types.js";

/**
 * Inventory projection — the external deliverable.
 * The same graph that ops teams see as a topology becomes a flat list for customers.
 * This is only possible because data comes first and rendering second.
 */

export interface InventoryRow {
  id: string;
  type: string;
  label: string;
  description: string;
  ref: string;
  tags: string;
  group: string;
  connections: number;
}

export function toInventory(graph: Graph): InventoryRow[] {
  const degree = new Map<string, number>();
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  const groupOf = new Map<string, string>();
  for (const group of graph.groups) {
    for (const child of group.children) groupOf.set(child, group.label);
  }
  return graph.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    label: node.label,
    description: node.description ?? "",
    ref: node.ref ?? "",
    tags: (node.tags ?? []).join(", "),
    group: groupOf.get(node.id) ?? "",
    connections: degree.get(node.id) ?? 0,
  }));
}

/** CSV export of the inventory — the "对外交付清单". */
export function inventoryToCsv(rows: InventoryRow[]): string {
  const headers: (keyof InventoryRow)[] = [
    "id",
    "type",
    "label",
    "description",
    "ref",
    "tags",
    "group",
    "connections",
  ];
  const escape = (value: string | number): string => {
    const s = String(value);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n");
}

/** Simple text search across name, tags, type, ref and attrs. */
export function searchNodes(graph: Graph, query: string): Node[] {
  const q = query.trim().toLowerCase();
  if (q === "") return graph.nodes;
  return graph.nodes.filter((node) => {
    if (node.label.toLowerCase().includes(q)) return true;
    if (node.type.toLowerCase().includes(q)) return true;
    if (node.id.toLowerCase().includes(q)) return true;
    if (node.ref?.toLowerCase().includes(q)) return true;
    if (node.tags?.some((t) => t.toLowerCase().includes(q))) return true;
    if (node.attrs && JSON.stringify(node.attrs).toLowerCase().includes(q)) return true;
    return false;
  });
}
