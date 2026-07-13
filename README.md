# TopoX

An engine for describing, editing, running and monitoring topology systems.

Not a drawing app. Not a whiteboard. Not a flowchart tool.

## Principles

1. **Data first, not graphics first.** A topology is real data; the editor is just one view.
2. **Layout belongs to Views, never to the Graph.** The graph is pure relational data.
3. **Every mutation is an invertible `GraphDiff`.** User edits, AI proposals and imports all enter through the same pipeline: `Prompt → DSL → GraphDiff → Preview → Confirm → Apply`. Undo/redo, audit and replay come for free.
4. **The kernel only knows relations, never business.** `net-router` is an opaque string to the core; domains extend through node types, attrs and plugins.
5. **AI never touches the canvas.** AI emits diffs like everyone else.

## Packages

| Package | Purpose |
| --- | --- |
| `@topox/core` | Kernel: `Graph`/`Node`/`Edge`/`Group`/`View` model, validation, diff engine (`applyDiff`/`invertDiff`), `History`, inventory projection. Zero runtime dependencies. |
| `@topox/dsl` | Line-oriented topology DSL compiled to `GraphDiff` (the AI output format), plus `docToDsl` serialization and an LLM prompt guide. |
| `@topox/editor` | React Flow canvas. A controlled view: doc in, diffs out. Includes dagre auto-layout emitted as a diff. |
| `@topox/interop` | YAML (full fidelity) and Mermaid flowchart (export + tolerant import) interchange. |
| `apps/studio` | Demo app: Canvas / Inventory / JSON views, JSON/YAML/Mermaid import & export, CSV export, AI panel (Prompt → DSL → Diff → Preview → Apply), diff history with undo/redo. Builds to static assets embeddable in a Go binary. |

## Core objects

```
Graph  — nodes, edges, groups (pure relations)
Node   — id, type, label, ref (external resource binding), attrs
Edge   — id, source, target, directed?, attrs
Group  — nestable containers
View   — layout (x/y/w/h per node) + viewport; owned by the editor
TopoDoc — { graph, views }: the editable unit
GraphDiff — ordered, invertible ops; the only way anything changes
```

## Development

```sh
npm install
npm run build   # build all workspaces
npm test        # run all tests
npm run dev     # start studio at http://localhost:5173
```

## Roadmap

- **Phase 2 — Runtime:** node status / dynamic metrics overlay (state producers address nodes via `Node.ref`), WebSocket/SSE refresh, snapshots, timeline replay. Runtime never stores layout.
- **Phase 3 — Agents, collaboration, plugins.**

Boundaries (what TopoX will not become): Office, PPT, Visio, XMind, whiteboards, Gantt, UML/BPMN suites, database designers, CAD.
