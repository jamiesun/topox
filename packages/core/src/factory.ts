import type { Graph, TopoDoc, View } from "./types.js";

export function emptyGraph(id: string, name?: string): Graph {
  return {
    schemaVersion: 1,
    id,
    ...(name !== undefined ? { meta: { name } } : {}),
    nodes: [],
    edges: [],
    groups: [],
  };
}

export function emptyView(id: string, name: string): View {
  return { id, name, layout: {} };
}

export function emptyDoc(id: string, name?: string): TopoDoc {
  return { graph: emptyGraph(id, name), views: [emptyView("default", "Default")] };
}
