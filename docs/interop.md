# Interchange formats

`@topox/interop` converts external graph formats to and from `TopoDoc`. The
parsers intentionally support practical subsets rather than attempting to
implement every feature of Mermaid, Graphviz, or GraphML.

| Format | Import | Export | Layout |
| --- | --- | --- | --- |
| JSON / YAML | Full `TopoDoc` | Full `TopoDoc` | Preserved |
| Mermaid flowchart | Tolerant relational subset | Nodes, edges, and nested subgraphs | Not represented |
| Graphviz DOT | Tolerant common subset | Nodes, edges, and nested clusters | Not represented |
| GraphML | Nodes, edges, nested groups, and scalar data | Standard GraphML with TopoX data keys | First View, best effort |
| CSV | — | Inventory projection | Not applicable |

## Graphviz DOT

DOT import accepts:

- `graph` and `digraph`, with optional `strict` and graph IDs;
- quoted or simple bare IDs;
- node statements and single `--` or `->` edge statements;
- `label`, `id`, `dir`, and TopoX attributes emitted by the exporter;
- nested `subgraph cluster_*` groups;
- `#`, `//`, and block comments.

Statements outside this subset are skipped with line-level warnings. Edge
chains, ports, HTML labels, compass points, and Graphviz geometry are not
interpreted.

DOT export always emits a `digraph` so directed and undirected edges can
coexist. An undirected edge is written as `->` with `dir=none`; groups are
written as nested `subgraph cluster_*` blocks. TopoX custom attributes use
JSON-encoded `topox_attr_*` values.

## GraphML

GraphML import accepts standard `<key>` / `<data>` scalar values for graphs,
nodes, and edges. A node containing a nested `<graph>` becomes a TopoX group.
Unknown scalar data becomes custom attributes; unknown namespaced extension
elements, including yEd graphics payloads, are ignored safely.

GraphML export writes standard GraphML that tools such as yEd can open. TopoX
IDs and model fields are ordinary data keys, custom attributes are JSON values
marked in the `topox` namespace, and nested groups are represented by nested
graphs.

Only the first TopoX View participates in GraphML geometry exchange. Scalar
`x`, `y`, `width`, and `height` values are read or written when available.
Vendor-specific drawing geometry, routing, styling, and viewport state are not
interpreted. Studio applies automatic layout after DOT/Mermaid import and
after GraphML import when any node lacks a position.

## Studio import safety

Studio recognizes `.dot`, `.gv`, and `.graphml` alongside the existing
formats. Every parsed document passes `validateDoc` before replacing the
current document. Syntax or validation failure leaves the existing document
unchanged; recoverable subset mismatches are shown as import warnings.
