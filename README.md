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
| `@topox/core` | Kernel: graph model, validation, invertible diffs, `History`, runtime Timeline, Trace, and versioned runtime snapshots. Zero runtime dependencies. |
| `@topox/dsl` | Line-oriented topology DSL compiled to `GraphDiff` (the AI output format), plus `docToDsl` serialization and an LLM prompt guide. |
| `@topox/editor` | React Flow canvas. A controlled view: doc in, diffs out. Includes dagre auto-layout emitted as a diff. |
| `@topox/interop` | JSON/YAML, Mermaid, Graphviz DOT, and GraphML interchange. Supported subsets and layout guarantees are documented in [`docs/interop.md`](docs/interop.md). |
| `@topox/embed` | Framework-agnostic embed: `mountTopoView(el, opts)` mounts a canvas into any DOM element (React bundled inside — hosts need no framework). Handle offers `applyDiff`/`undo`/`autoLayout`/`connectSSE`/`connectWS`/…. See [`docs/embedding.md`](docs/embedding.md). |
| `apps/studio` | Demo app: Canvas / Inventory / JSON views, node palette (Insert menu) & one-click connect, local project management (localStorage, auto-save), JSON/YAML/Mermaid/DOT/GraphML import & export, CSV export, AI panel (Prompt → DSL → Diff → Preview → Apply), diff history with undo/redo. Builds to static assets embeddable in a Go binary. |

## Core objects

```
Graph  — nodes, edges, groups (pure relations)
Node   — id, type, label, ref (external resource binding), attrs
Edge   — id, source, target, directed?, attrs
Group  — nestable containers
View   — layout (x/y/w/h per node) + viewport; owned by the editor
TopoDoc — { graph, views }: the editable unit
GraphDiff — ordered, invertible ops; the only way anything changes
RuntimeSnapshot — versioned RuntimeEvent window for offline replay (never part of TopoDoc)
```

Runtime snapshot schema and host API: [`docs/runtime-snapshots.md`](docs/runtime-snapshots.md).

Plugin API boundary draft (design only): [`docs/plugins.md`](docs/plugins.md).

## Development

```sh
npm install
npm run build   # build all workspaces
npm test        # run all tests
npm run dev     # start studio at http://localhost:5173
npm run e2e -w apps/studio   # browser E2E (needs `npx playwright install chromium` once)
```

Quality floor: every top-level feature needs a happy-path E2E, and state-mutating features need failure/rollback coverage — see the [acceptance matrix](docs/roadmap.md#验收矩阵业务能力覆盖矩阵) in the roadmap. Agent contributors should also read [AGENTS.md](AGENTS.md).

## Roadmap

See [`docs/roadmap.md`](docs/roadmap.md) for the full project profile: target state, current capabilities with evidence, hard non-goals, direction, and the acceptance matrix.

- **Phase 2 — Runtime:** node status / dynamic metrics overlay (state producers address nodes via `Node.ref`), WebSocket/SSE refresh, snapshots, timeline replay. Runtime never stores layout.
- **Phase 3 — Agents, collaboration, plugins.**

Boundaries (what TopoX will not become): Office, PPT, Visio, XMind, whiteboards, Gantt, UML/BPMN suites, database designers, CAD.
