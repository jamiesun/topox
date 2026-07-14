# @talkincode/topox-mcp

MCP stdio server for proposal-backed TopoX workflows.

The server exposes read, validation, DSL, import/export and proposal tools for
an explicit document file. It does not apply diffs to the document. Studio owns
visual preview and user-confirmed Apply.

```sh
topox-mcp --doc ./topology.topox.json --proposal-dir ./.topox/proposals
```

Key boundaries:

- The server re-reads `--doc` on every tool call.
- Proposal `baseHash` is computed from `doc.graph` only; layout changes do not
  stale semantic proposals.
- Hash-verified Apply is a Studio shared-mode feature (`?src=`/`?save=`).
  Browser-local projects show proposals as base unverifiable.
- Runtime state, secrets, plugin schemas and UI state are not serialized into
  proposal artifacts.
