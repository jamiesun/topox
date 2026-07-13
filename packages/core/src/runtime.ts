/**
 * RuntimeState — the live overlay.
 *
 * Constitution:
 * - Runtime state NEVER touches Graph, View or History. It is ephemeral overlay
 *   data resolved against the graph at render time; layout stays with the editor.
 * - Producers address nodes by `Node.ref` (the business resource binding) first,
 *   falling back to node id. Edges are addressed by edge id.
 * - State evolves through RuntimeEvents (immutable apply), so streams from
 *   WebSocket/SSE, simulators and replays all share one code path — and a
 *   timeline is just a list of events.
 */
import type { EdgeId, NodeId, TopoDoc } from "./types.js";

export type NodeStatus = "running" | "waiting" | "stopped" | "error" | "offline";

export type MetricValue = number | string;

export interface NodeRuntime {
  status?: NodeStatus;
  /** Short human-readable detail, e.g. "OOMKilled", "reconnecting". */
  message?: string;
  /** cpu, memory, latency, qps, tokens, health, ... — kernel treats keys as opaque. */
  metrics?: Record<string, MetricValue>;
  updatedAt?: number;
}

export interface EdgeRuntime {
  /** Traffic currently flowing — editors may animate the edge. */
  active?: boolean;
  /** traffic, throughput, bandwidth, errorRate, ... */
  metrics?: Record<string, MetricValue>;
  updatedAt?: number;
}

export interface RuntimeState {
  /** Keyed by Node.ref (preferred) or node id. */
  nodes: Record<string, NodeRuntime>;
  /** Keyed by edge id. */
  edges: Record<string, EdgeRuntime>;
  /** Timestamp of the last applied event. */
  ts?: number;
}

export function emptyRuntime(): RuntimeState {
  return { nodes: {}, edges: {} };
}

/**
 * One unit of live change. `patch: null` removes the entry (entity vanished);
 * `snapshot` replaces the whole state (initial sync, replay seek).
 */
export type RuntimeEvent =
  | { kind: "node"; key: string; patch: NodeRuntime | null; ts?: number }
  | { kind: "edge"; key: string; patch: EdgeRuntime | null; ts?: number }
  | { kind: "snapshot"; state: RuntimeState; ts?: number };

function mergeNode(base: NodeRuntime | undefined, patch: NodeRuntime): NodeRuntime {
  return {
    ...base,
    ...patch,
    ...(base?.metrics !== undefined || patch.metrics !== undefined
      ? { metrics: { ...base?.metrics, ...patch.metrics } }
      : {}),
  };
}

function mergeEdge(base: EdgeRuntime | undefined, patch: EdgeRuntime): EdgeRuntime {
  return {
    ...base,
    ...patch,
    ...(base?.metrics !== undefined || patch.metrics !== undefined
      ? { metrics: { ...base?.metrics, ...patch.metrics } }
      : {}),
  };
}

/** Pure, immutable event application. Metrics merge per key; other fields overwrite. */
export function applyRuntimeEvent(state: RuntimeState, event: RuntimeEvent): RuntimeState {
  const ts = event.ts ?? Date.now();
  if (event.kind === "snapshot") {
    return { ...event.state, ts };
  }
  if (event.kind === "node") {
    const nodes = { ...state.nodes };
    if (event.patch === null) delete nodes[event.key];
    else nodes[event.key] = mergeNode(nodes[event.key], { updatedAt: ts, ...event.patch });
    return { ...state, nodes, ts };
  }
  const edges = { ...state.edges };
  if (event.patch === null) delete edges[event.key];
  else edges[event.key] = mergeEdge(edges[event.key], { updatedAt: ts, ...event.patch });
  return { ...state, edges, ts };
}

export interface ResolvedRuntime {
  nodes: Map<NodeId, NodeRuntime>;
  edges: Map<EdgeId, EdgeRuntime>;
}

/**
 * Joins runtime state onto a document: `Node.ref` wins over node id, so the
 * same producer keeps working when a topology is redrawn with new node ids.
 */
export function resolveRuntime(doc: TopoDoc, state: RuntimeState): ResolvedRuntime {
  const nodes = new Map<NodeId, NodeRuntime>();
  for (const node of doc.graph.nodes) {
    const hit =
      (node.ref !== undefined ? state.nodes[node.ref] : undefined) ?? state.nodes[node.id];
    if (hit) nodes.set(node.id, hit);
  }
  const edges = new Map<EdgeId, EdgeRuntime>();
  for (const edge of doc.graph.edges) {
    const hit = state.edges[edge.id];
    if (hit) edges.set(edge.id, hit);
  }
  return { nodes, edges };
}
