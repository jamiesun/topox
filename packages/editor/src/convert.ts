import type { Edge as RFEdge, Node as RFNode } from "@xyflow/react";
import type {
  Graph,
  Group,
  MetricValue,
  NodeStatus,
  ResolvedRuntime,
  TopoDoc,
  View,
} from "@topox/core";

export interface TopoNodeData extends Record<string, unknown> {
  label: string;
  nodeType: string;
  ref?: string;
  icon?: string;
  /** Document-backed edit lock; nodes remain selectable. */
  locked: boolean;
  /** Live overlay — resolved runtime, never stored in the doc. */
  status?: NodeStatus;
  message?: string;
  metrics?: Record<string, MetricValue>;
  /** Ephemeral search projection; never stored in the document. */
  searchMatch?: boolean;
  searchCurrent?: boolean;
  searchDimmed?: boolean;
}

/** Data for group container (expanded) and proxy (collapsed) nodes. */
export interface TopoGroupData extends Record<string, unknown> {
  label: string;
  kind: "container" | "proxy";
  groupId: string;
  /** Transitive node count (visible members for containers, hidden for proxies). */
  memberCount: number;
  depth: number;
  /** Proxy only: rollup of member statuses from the runtime overlay. */
  statusSummary?: Partial<Record<NodeStatus, number>>;
  /** A collapsed proxy inherits search state from its hidden members. */
  searchMatch?: boolean;
  searchCurrent?: boolean;
  searchDimmed?: boolean;
}

export type TopoRFNode = RFNode<TopoNodeData | TopoGroupData>;

export interface SearchProjection {
  matchedNodeIds: ReadonlySet<string>;
  currentNodeId?: string;
}

const DEFAULT_WIDTH = 150;
const DEFAULT_HEIGHT = 60;
const PROXY_WIDTH = 190;
const PROXY_HEIGHT = 64;
const PAD_TOP = 38;
const PAD = 16;

/** React Flow ids for group-derived nodes; keeps them out of the node id space. */
export const GROUP_ID_PREFIX = "group:";
export const groupFlowId = (groupId: string): string => `${GROUP_ID_PREFIX}${groupId}`;
export const flowIdToGroupId = (flowId: string): string | null =>
  flowId.startsWith(GROUP_ID_PREFIX) ? flowId.slice(GROUP_ID_PREFIX.length) : null;

export function formatMetrics(metrics: Record<string, MetricValue>, max = 3): string {
  return Object.entries(metrics)
    .slice(0, max)
    .map(([k, v]) => `${k} ${typeof v === "number" ? +v.toFixed(1) : v}`)
    .join(" · ");
}

function projectSearch(nodeIds: readonly string[], search: SearchProjection | undefined) {
  if (search === undefined) return {};
  const searchCurrent =
    search.currentNodeId !== undefined && nodeIds.includes(search.currentNodeId);
  const searchMatch =
    searchCurrent || nodeIds.some((nodeId) => search.matchedNodeIds.has(nodeId));
  return {
    searchMatch,
    searchCurrent,
    searchDimmed: !searchMatch,
  };
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GroupIndex {
  byId: Map<string, Group>;
  parentOf: Map<string, string>;
  depth: Map<string, number>;
}

function indexGroups(graph: Graph): GroupIndex {
  const byId = new Map(graph.groups.map((g) => [g.id, g]));
  const parentOf = new Map<string, string>();
  for (const g of graph.groups) {
    for (const child of g.children) parentOf.set(child, g.id);
  }
  const depth = new Map<string, number>();
  const depthOf = (id: string): number => {
    const hit = depth.get(id);
    if (hit !== undefined) return hit;
    depth.set(id, 0); // cycle guard
    const parent = parentOf.get(id);
    const d = parent !== undefined && byId.has(parent) ? depthOf(parent) + 1 : 0;
    depth.set(id, d);
    return d;
  };
  for (const g of graph.groups) depthOf(g.id);
  return { byId, parentOf, depth };
}

/** Outermost collapsed ancestor group of an entity (its proxy), or null. */
function proxyFor(id: string, idx: GroupIndex): string | null {
  let cur = idx.parentOf.get(id);
  let hit: string | null = null;
  const seen = new Set<string>();
  while (cur !== undefined && !seen.has(cur)) {
    seen.add(cur);
    if (idx.byId.get(cur)?.collapsed === true) hit = cur;
    cur = idx.parentOf.get(cur);
  }
  return hit;
}

/** Transitive node members of a group (through nested groups). */
export function transitiveNodeMembers(graph: Graph, groupId: string): string[] {
  const byId = new Map(graph.groups.map((g) => [g.id, g]));
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const out: string[] = [];
  const walk = (gid: string, seen: Set<string>): void => {
    if (seen.has(gid)) return;
    seen.add(gid);
    const g = byId.get(gid);
    if (!g) return;
    for (const child of g.children) {
      if (nodeIds.has(child)) out.push(child);
      else if (byId.has(child)) walk(child, seen);
    }
  };
  walk(groupId, new Set());
  return out;
}

/** Handle ids rendered on all four sides of nodes and proxies. */
export type HandleSide = "top" | "bottom" | "left" | "right";

/** Pick the visually shortest pair of sides for an edge between two boxes. */
function pickHandles(source: Box, target: Box): { sourceHandle: HandleSide; targetHandle: HandleSide } {
  const dx = target.x + target.width / 2 - (source.x + source.width / 2);
  const dy = target.y + target.height / 2 - (source.y + source.height / 2);
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0
      ? { sourceHandle: "right", targetHandle: "left" }
      : { sourceHandle: "left", targetHandle: "right" };
  }
  return dy > 0
    ? { sourceHandle: "bottom", targetHandle: "top" }
    : { sourceHandle: "top", targetHandle: "bottom" };
}

/** Projects graph + view (+ optional runtime overlay) into React Flow shapes. Pure. */
export function toFlow(
  doc: TopoDoc,
  viewId: string,
  runtime?: ResolvedRuntime,
  search?: SearchProjection,
): { nodes: TopoRFNode[]; edges: RFEdge[] } {
  const { graph } = doc;
  const view: View | undefined = doc.views.find((v) => v.id === viewId) ?? doc.views[0];
  const layout = view?.layout ?? {};
  const idx = indexGroups(graph);
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  // ------------------------------------------------------------------
  // positions: every node gets a box (stored layout or fallback grid)
  // ------------------------------------------------------------------
  let fallbackIndex = 0;
  const nodeBox = new Map<string, Box>();
  for (const node of graph.nodes) {
    const pos = layout[node.id];
    if (pos) {
      nodeBox.set(node.id, {
        x: pos.x,
        y: pos.y,
        width: pos.width ?? DEFAULT_WIDTH,
        height: pos.height ?? DEFAULT_HEIGHT,
      });
    } else {
      nodeBox.set(node.id, {
        x: (fallbackIndex % 5) * 200 + 40,
        y: Math.floor(fallbackIndex / 5) * 120 + 40,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
      });
      fallbackIndex += 1;
    }
  }

  // node → proxy group (outermost collapsed ancestor)
  const nodeProxy = new Map<string, string>();
  for (const node of graph.nodes) {
    const p = proxyFor(node.id, idx);
    if (p !== null) nodeProxy.set(node.id, p);
  }

  const unionBox = (boxes: Box[]): Box | null => {
    if (boxes.length === 0) return null;
    const x1 = Math.min(...boxes.map((b) => b.x));
    const y1 = Math.min(...boxes.map((b) => b.y));
    const x2 = Math.max(...boxes.map((b) => b.x + b.width));
    const y2 = Math.max(...boxes.map((b) => b.y + b.height));
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  };

  // proxy boxes: centered on the bounding box of hidden members
  const proxyBox = new Map<string, Box>();
  for (const g of graph.groups) {
    if (g.collapsed !== true) continue;
    if (proxyFor(g.id, idx) !== null) continue; // swallowed by an outer proxy
    const members = transitiveNodeMembers(graph, g.id);
    const box = unionBox(
      members.map((m) => nodeBox.get(m)).filter((b): b is Box => b !== undefined),
    );
    proxyBox.set(g.id, {
      x: box ? box.x + box.width / 2 - PROXY_WIDTH / 2 : 40,
      y: box ? box.y + box.height / 2 - PROXY_HEIGHT / 2 : 40,
      width: PROXY_WIDTH,
      height: PROXY_HEIGHT,
    });
  }

  // container boxes for visible expanded groups, innermost first so outer
  // containers wrap inner ones
  const containerBox = new Map<string, Box>();
  const expandedGroups = graph.groups
    .filter((g) => g.collapsed !== true && proxyFor(g.id, idx) === null)
    .sort((a, b) => (idx.depth.get(b.id) ?? 0) - (idx.depth.get(a.id) ?? 0));
  for (const g of expandedGroups) {
    const memberBoxes: Box[] = [];
    for (const child of g.children) {
      if (nodeIds.has(child)) {
        if (!nodeProxy.has(child)) {
          const b = nodeBox.get(child);
          if (b) memberBoxes.push(b);
        }
      } else {
        const b = containerBox.get(child) ?? proxyBox.get(child);
        if (b) memberBoxes.push(b);
      }
    }
    const box = unionBox(memberBoxes);
    containerBox.set(
      g.id,
      box
        ? {
            x: box.x - PAD,
            y: box.y - PAD_TOP,
            width: box.width + PAD * 2,
            height: box.height + PAD_TOP + PAD,
          }
        : { x: 40, y: 40, width: 200, height: 100 },
    );
  }

  // ------------------------------------------------------------------
  // emit nodes: containers shallow→deep (deep paints above), proxies, nodes
  // ------------------------------------------------------------------
  const nodes: TopoRFNode[] = [];

  for (const g of [...expandedGroups].sort(
    (a, b) => (idx.depth.get(a.id) ?? 0) - (idx.depth.get(b.id) ?? 0),
  )) {
    const box = containerBox.get(g.id);
    if (!box) continue;
    nodes.push({
      id: groupFlowId(g.id),
      type: "topoGroup",
      position: { x: box.x, y: box.y },
      width: box.width,
      height: box.height,
      draggable: false,
      selectable: true,
      zIndex: -10 + (idx.depth.get(g.id) ?? 0),
      data: {
        label: g.label,
        kind: "container",
        groupId: g.id,
        memberCount: transitiveNodeMembers(graph, g.id).filter((m) => !nodeProxy.has(m)).length,
        depth: idx.depth.get(g.id) ?? 0,
      },
    });
  }

  for (const [gid, box] of proxyBox) {
    const g = idx.byId.get(gid);
    if (!g) continue;
    const members = transitiveNodeMembers(graph, gid);
    const allMembersLocked =
      members.length > 0 && members.every((member) => nodeById.get(member)?.locked === true);
    const summary: Partial<Record<NodeStatus, number>> = {};
    if (runtime) {
      for (const m of members) {
        const st = runtime.nodes.get(m)?.status;
        if (st !== undefined) summary[st] = (summary[st] ?? 0) + 1;
      }
    }
    nodes.push({
      id: groupFlowId(gid),
      type: "topoGroup",
      position: { x: box.x, y: box.y },
      width: box.width,
      height: box.height,
      ...(allMembersLocked ? { draggable: false } : {}),
      data: {
        label: g.label,
        kind: "proxy",
        groupId: gid,
        memberCount: members.length,
        depth: idx.depth.get(gid) ?? 0,
        ...(Object.keys(summary).length > 0 ? { statusSummary: summary } : {}),
        ...projectSearch(members, search),
      },
    });
  }

  for (const node of graph.nodes) {
    if (nodeProxy.has(node.id)) continue; // hidden inside a collapsed group
    const box = nodeBox.get(node.id);
    if (!box) continue;
    const rt = runtime?.nodes.get(node.id);
    nodes.push({
      id: node.id,
      type: "topo",
      position: { x: box.x, y: box.y },
      width: box.width,
      height: box.height,
      ...(node.locked === true ? { draggable: false } : {}),
      data: {
        label: node.label,
        nodeType: node.type,
        locked: node.locked === true,
        ...(node.ref !== undefined ? { ref: node.ref } : {}),
        ...(node.icon !== undefined ? { icon: node.icon } : {}),
        ...(rt?.status !== undefined ? { status: rt.status } : {}),
        ...(rt?.message !== undefined ? { message: rt.message } : {}),
        ...(rt?.metrics !== undefined ? { metrics: rt.metrics } : {}),
        ...projectSearch([node.id], search),
      },
    });
  }

  // ------------------------------------------------------------------
  // edges: endpoints hidden in collapsed groups reroute to their proxy;
  // internal edges drop; parallel rerouted edges merge with a ×N count
  // ------------------------------------------------------------------
  const edges: RFEdge[] = [];
  const merged = new Map<
    string,
    { count: number; active: boolean; directed: boolean; source: string; target: string }
  >();

  // Every visible endpoint (node or proxy) has a box; edges anchor to the
  // side facing the other endpoint so links approach from the natural side.
  const endpointBox = (flowId: string): Box | undefined => {
    const gid = flowIdToGroupId(flowId);
    return gid !== null ? proxyBox.get(gid) : nodeBox.get(flowId);
  };
  const handlesFor = (source: string, target: string) => {
    const sourceBox = endpointBox(source);
    const targetBox = endpointBox(target);
    return sourceBox && targetBox ? pickHandles(sourceBox, targetBox) : {};
  };

  for (const edge of graph.edges) {
    const srcProxy = nodeProxy.get(edge.source);
    const dstProxy = nodeProxy.get(edge.target);
    const source = srcProxy !== undefined ? groupFlowId(srcProxy) : edge.source;
    const target = dstProxy !== undefined ? groupFlowId(dstProxy) : edge.target;
    if (source === target) continue; // fully inside one collapsed group

    const rt = runtime?.edges.get(edge.id);
    if (srcProxy === undefined && dstProxy === undefined) {
      const liveLabel = rt?.metrics !== undefined ? formatMetrics(rt.metrics, 2) : undefined;
      const label = liveLabel ?? edge.label;
      edges.push({
        id: edge.id,
        source,
        target,
        ...handlesFor(source, target),
        ...(label !== undefined ? { label } : {}),
        ...(edge.directed ? { markerEnd: "url(#topox-arrow)" } : {}),
        ...(rt?.active === true ? { animated: true } : {}),
        style: {
          stroke: edge.color ?? (rt?.active === true ? "#2563eb" : "#9aa4b2"),
          strokeWidth: rt?.active === true ? 2 : 1.5,
        },
        ...(liveLabel !== undefined
          ? { labelStyle: { fill: "#2563eb", fontWeight: 600, fontSize: 10 } }
          : {}),
        type: "default",
      });
    } else {
      const key = `${source}|${target}|${edge.directed === true}`;
      const entry = merged.get(key) ?? {
        count: 0,
        active: false,
        directed: edge.directed === true,
        source,
        target,
      };
      entry.count += 1;
      if (rt?.active === true) entry.active = true;
      merged.set(key, entry);
    }
  }

  for (const [key, m] of merged) {
    edges.push({
      id: `proxy-edge:${key}`,
      source: m.source,
      target: m.target,
      ...handlesFor(m.source, m.target),
      ...(m.count > 1 ? { label: `${m.count}×` } : {}),
      ...(m.directed ? { markerEnd: "url(#topox-arrow)" } : {}),
      ...(m.active ? { animated: true } : {}),
      style: {
        stroke: m.active ? "#2563eb" : "#9aa4b2",
        strokeWidth: m.active ? 2 : 1.5,
        strokeDasharray: "6 3",
      },
      labelStyle: { fill: "#64748b", fontWeight: 600, fontSize: 10 },
      type: "default",
    });
  }

  return { nodes, edges };
}
