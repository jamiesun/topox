# AGENTS.md

Guidance for AI agents and contributors working in this repository.

## Constitution (hard boundaries)

These rules are load-bearing. Do not violate them; if a task seems to require it, stop and ask.

1. **The kernel only knows relations.** No business/domain semantics (Kubernetes, RouterOS, Redis, …) in `@topox/core` — domains extend via `type` strings, `attrs`, schemas and plugins.
2. **Layout belongs to Views, never to Graph.** No coordinates on nodes.
3. **Every mutation is an invertible `GraphDiff`.** UI edits, AI proposals and imports all land as diffs (whole-document import replacement is the only exception, and it must pass `validateDoc` first).
4. **AI never touches the canvas or the document directly.** The only pipeline is `Prompt → DSL → GraphDiff → Preview → user confirm → Apply`.
5. **Runtime state never enters the document.** It is a render overlay addressed via `Node.ref`; it must not appear in `TopoDoc`, diffs, history or exports.
6. **`@topox/core` stays free of runtime dependencies.** Everything is JSON-serializable; `undefined` never crosses a wire; `null` in a patch means "delete this field".

Full project profile, direction and boundaries: [`docs/roadmap.md`](docs/roadmap.md).

## Acceptance matrix (hard rules)

The capability coverage matrix lives in [`docs/roadmap.md`](docs/roadmap.md#验收矩阵业务能力覆盖矩阵). The following coverage floor is **MUST**-level:

1. Every top-level feature MUST have at least one happy-path E2E verification.
2. Every high-risk feature MUST cover at least one failure path.
3. Every permission-related feature MUST be verified with at least two roles (currently N/A — single-user tool; re-evaluate when collaboration lands).
4. Every state-mutating operation MUST verify recovery/rollback after a failure at least once.
5. **Adding a top-level feature without adding its E2E and updating the matrix is an incomplete change.**

The matrix constrains *what must be verified*, not which framework or file layout to use.

## Development

```sh
npm install
npm run build   # required: the studio dev server loads workspace packages from dist/
npm test        # all workspaces, 48 tests
npm run dev     # studio at http://localhost:5173
```

Practical notes:

- After editing code under `packages/*`, run `npm run build` (or build that package) — the vite dev server serves `dist/`, not `src/`.
- `vitest` does not type-check; run the TypeScript build to catch type errors (`exactOptionalPropertyTypes` is on).
- Commits include the trailer `Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>` when authored by an agent.
