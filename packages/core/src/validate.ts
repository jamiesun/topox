import type { Graph, TopoDoc, ValidationIssue } from "./types.js";

/** Structural validation. Pure, dependency-free, no schema library. */
export function validateGraph(graph: Graph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (code: string, message: string, ref?: string) =>
    issues.push({ severity: "error", code, message, ...(ref !== undefined ? { ref } : {}) });
  const warn = (code: string, message: string, ref?: string) =>
    issues.push({ severity: "warning", code, message, ...(ref !== undefined ? { ref } : {}) });

  if (graph.schemaVersion !== 1) {
    err("schema_version", `unsupported schemaVersion: ${String(graph.schemaVersion)}`);
  }
  if (!graph.id || typeof graph.id !== "string") {
    err("graph_id", "graph.id must be a non-empty string");
  }

  const nodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (!node.id) {
      err("node_id", "node with empty id");
      continue;
    }
    if (nodeIds.has(node.id)) err("dup_node", `duplicate node id: ${node.id}`, node.id);
    nodeIds.add(node.id);
    if (typeof node.type !== "string" || node.type === "") {
      err("node_type", `node ${node.id}: type must be a non-empty string`, node.id);
    }
    if (typeof node.label !== "string") {
      err("node_label", `node ${node.id}: label must be a string`, node.id);
    }
  }

  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (!edge.id) {
      err("edge_id", "edge with empty id");
      continue;
    }
    if (edgeIds.has(edge.id)) err("dup_edge", `duplicate edge id: ${edge.id}`, edge.id);
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source)) {
      err("edge_source", `edge ${edge.id}: unknown source node ${edge.source}`, edge.id);
    }
    if (!nodeIds.has(edge.target)) {
      err("edge_target", `edge ${edge.id}: unknown target node ${edge.target}`, edge.id);
    }
  }

  const groupIds = new Set<string>();
  for (const group of graph.groups) {
    if (!group.id) {
      err("group_id", "group with empty id");
      continue;
    }
    if (groupIds.has(group.id)) err("dup_group", `duplicate group id: ${group.id}`, group.id);
    if (nodeIds.has(group.id)) err("group_id_clash", `group id collides with node id: ${group.id}`, group.id);
    groupIds.add(group.id);
  }

  const memberOf = new Map<string, string>();
  for (const group of graph.groups) {
    for (const child of group.children) {
      if (!nodeIds.has(child) && !groupIds.has(child)) {
        err("group_child", `group ${group.id}: unknown child ${child}`, group.id);
        continue;
      }
      const prev = memberOf.get(child);
      if (prev !== undefined && prev !== group.id) {
        err("multi_parent", `${child} belongs to both ${prev} and ${group.id}`, child);
      }
      memberOf.set(child, group.id);
    }
  }
  // Cycle detection over group nesting.
  for (const group of graph.groups) {
    let cursor: string | undefined = memberOf.get(group.id);
    const seen = new Set<string>([group.id]);
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        err("group_cycle", `group nesting cycle involving ${group.id}`, group.id);
        break;
      }
      seen.add(cursor);
      cursor = memberOf.get(cursor);
    }
  }

  if (graph.nodes.length === 0 && graph.edges.length > 0) {
    warn("edges_without_nodes", "graph has edges but no nodes");
  }

  return issues;
}

export function validateDoc(doc: TopoDoc): ValidationIssue[] {
  const issues = validateGraph(doc.graph);
  const nodeIds = new Set(doc.graph.nodes.map((n) => n.id));
  const viewIds = new Set<string>();
  for (const view of doc.views) {
    if (viewIds.has(view.id)) {
      issues.push({ severity: "error", code: "dup_view", message: `duplicate view id: ${view.id}`, ref: view.id });
    }
    viewIds.add(view.id);
    for (const nodeId of Object.keys(view.layout)) {
      if (!nodeIds.has(nodeId)) {
        issues.push({
          severity: "warning",
          code: "layout_orphan",
          message: `view ${view.id}: layout for unknown node ${nodeId}`,
          ref: view.id,
        });
      }
    }
  }
  return issues;
}

export function isValid(issues: ValidationIssue[]): boolean {
  return issues.every((i) => i.severity !== "error");
}
