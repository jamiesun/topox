/**
 * TopoX kernel types — the constitution.
 *
 * Rules:
 * 1. The kernel only knows nodes, edges, attributes and state — never business domains.
 * 2. Graph carries pure relational data. Layout belongs to View, never to Node.
 * 3. Every mutation is an invertible DiffOp. Documents are immutable values.
 * 4. Everything is JSON-serializable. `undefined` never crosses a wire; `null` in
 *    patches means "delete this field".
 */

export type NodeId = string;
export type EdgeId = string;
export type GroupId = string;
export type ViewId = string;

/** JSON-safe attribute values. */
export type AttrValue =
  | string
  | number
  | boolean
  | null
  | AttrValue[]
  | { [key: string]: AttrValue };

export type Attrs = Record<string, AttrValue>;

export interface Node {
  id: NodeId;
  /** Domain vocabulary lives here (e.g. "net-router"). The kernel treats it as an opaque string. */
  type: string;
  label: string;
  description?: string;
  icon?: string;
  tags?: string[];
  /**
   * Binding to an external business resource (generalizes teams* `resid`).
   * Runtime state producers address nodes through this, never through layout.
   */
  ref?: string;
  attrs?: Attrs;
}

export interface Edge {
  id: EdgeId;
  source: NodeId;
  target: NodeId;
  /** Defaults to false (undirected). */
  directed?: boolean;
  type?: string;
  label?: string;
  color?: string;
  weight?: number;
  attrs?: Attrs;
}

export interface Group {
  id: GroupId;
  label: string;
  /** Node or group ids. Nesting is expressed by listing a group id here. */
  children: string[];
  collapsed?: boolean;
  attrs?: Attrs;
}

export interface GraphMeta {
  name?: string;
  description?: string;
  attrs?: Attrs;
}

/** Pure relational data. No coordinates, no colors-for-rendering-state, no runtime. */
export interface Graph {
  schemaVersion: 1;
  id: string;
  meta?: GraphMeta;
  nodes: Node[];
  edges: Edge[];
  groups: Group[];
}

export interface NodeLayout {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** A projection of a Graph. Owns layout. Editors read/write Views, never Graph geometry. */
export interface View {
  id: ViewId;
  name: string;
  layout: Record<NodeId, NodeLayout>;
  viewport?: Viewport;
}

/** The editable unit: one graph plus its views. */
export interface TopoDoc {
  graph: Graph;
  views: View[];
}

/** A field patch. `null` deletes the field; absent keys are untouched. `id` is immutable. */
export type Patch<T> = {
  [K in Exclude<keyof T, "id">]?: T[K] | null;
};

export type DiffOp =
  | { op: "add_node"; node: Node }
  | { op: "remove_node"; node: Node }
  | { op: "update_node"; id: NodeId; before: Patch<Node>; after: Patch<Node> }
  | { op: "add_edge"; edge: Edge }
  | { op: "remove_edge"; edge: Edge }
  | { op: "update_edge"; id: EdgeId; before: Patch<Edge>; after: Patch<Edge> }
  | { op: "add_group"; group: Group }
  | { op: "remove_group"; group: Group }
  | { op: "update_group"; id: GroupId; before: Patch<Group>; after: Patch<Group> }
  | { op: "update_meta"; before: Patch<GraphMeta & { id: never }>; after: Patch<GraphMeta & { id: never }> }
  | { op: "add_view"; view: View }
  | { op: "remove_view"; view: View }
  | {
      op: "set_layout";
      viewId: ViewId;
      nodeId: NodeId;
      before: NodeLayout | null;
      after: NodeLayout | null;
    };

/**
 * The unit of change. Everything — user edits, AI proposals, imports — enters the
 * system as a GraphDiff. Apply it, preview it, invert it, audit it.
 */
export interface GraphDiff {
  /** Optional provenance: "user", "ai", "import:webix", ... */
  origin?: string;
  /** Human-readable summary, e.g. for history panels and audit logs. */
  summary?: string;
  ops: DiffOp[];
}

export interface ValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  /** Offending entity id, when applicable. */
  ref?: string;
}
