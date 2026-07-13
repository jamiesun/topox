# Embedding TopoX in your frontend

`@topox/embed` mounts a full topology canvas into any DOM element. React and
React Flow are bundled inside — the host page needs **no framework**: plain
HTML, server-rendered templates, webix, jQuery, Vue, or another React app all
work the same way.

## Install

Not yet on npm. Consume it from the repo:

```bash
# option A — git dependency
npm i git+https://github.com/jamiesun/topox.git#main

# option B — pack a tarball from a checkout
cd topox && npm run build -ws
cd packages/embed && npm pack   # → topox-embed-0.1.0.tgz
npm i /path/to/topox-embed-0.1.0.tgz
```

Two artifacts ship in `packages/embed/dist/`:

| Artifact | For | Global |
| --- | --- | --- |
| `index.js` (ESM) | bundler hosts (vite, webpack) — `import { mountTopoView } from "@topox/embed"` | — |
| `topox-embed.standalone.js` (IIFE) | `<script src>` pages, server templates | `window.TopoX` |

Styles are injected automatically at mount; no separate CSS file to load.

## Mount a viewer

```html
<div id="topo" style="height: 480px"></div>
<script src="/static/topox-embed.standalone.js"></script>
<script>
  const view = TopoX.mountTopoView(document.getElementById("topo"), {
    doc: myTopoDoc,          // TopoDoc JSON (graph + views)
    readOnly: true,          // default: viewer
    onSelect: (sel) => console.log(sel.nodeIds),
  });
  view.autoLayout({ direction: "TB" });   // if the view has no saved layout
</script>
```

`TopoDoc` is the same JSON the studio and `@topox/interop` (YAML / Mermaid)
produce — one model everywhere.

## Configure data properties

Everything is data. Build or amend the doc before mounting, or apply diffs
after:

```js
// nodes carry type, label, ref (external binding) and free-form attrs
{ id: "fw", type: "net-firewall", label: "Firewall",
  ref: "dev:fw-01", attrs: { site: "POP-3", model: "RB5009" } }

// change the doc later — same diff pipeline the canvas uses, so it undoes
view.applyDiff({
  summary: "add cpe",
  ops: [{ op: "add_node", node: { id: "cpe9", type: "net-cpe", label: "CPE 9" } }],
});
view.undo();  view.redo();
```

Handle API: `getDoc / setDoc / applyDiff / undo / redo / autoLayout /
setReadOnly / pushRuntimeEvent / setRuntimeState / connectSSE / destroy`.
Edits made on the canvas surface as `onDiff(diff, doc)` — persist them to your
backend from there.

## Live status over SSE

The wire protocol is one JSON-encoded `RuntimeEvent` per SSE `data:` line:

```
data: {"kind":"snapshot","state":{"nodes":{"dev:fw-01":{"status":"running","metrics":{"cpu":12}}},"edges":{}}}

data: {"kind":"node","key":"dev:fw-01","patch":{"status":"error","metrics":{"latency":250}}}

data: {"kind":"edge","key":"e1","patch":{"metrics":{"mbps":940}}}

data: {"kind":"node","key":"cpe:1001","patch":null}     ← entity vanished
```

Rules:

- send a `snapshot` first so late joiners sync in one message;
- `key` matches `Node.ref` when present, else the node id — producers keep
  working when a topology is redrawn with new ids;
- `metrics` merge per key, other fields overwrite; `patch: null` removes;
- statuses: `running · waiting · stopped · error · offline`.

Client side:

```js
view.connectSSE("/api/topo/stream");            // overlay updates live
// or push events yourself (WebSocket, polling, tests):
view.pushRuntimeEvent({ kind: "node", key: "dev:fw-01", patch: { status: "running" } });
```

Runtime state is an overlay — it never touches the document or layouts.

Headless (no canvas) consumption uses the same client from `@topox/core`:

```js
import { connectRuntimeSSE } from "@topox/core";
const sub = connectRuntimeSSE("/api/topo/stream", {
  onState: (state) => render(state),
  onStatus: (s) => console.log("sse:", s),   // connecting|open|retrying|closed
});
sub.close();
```

## Full editing: link to a shared studio

The embed handles viewing and light editing. For the full editing surface
(Inspector, AI panel, import/export, grouping, timeline) don't rebuild it —
deploy **one shared studio** and link to it. The studio builds to plain static
files (`apps/studio && npm run build` → `dist/`), so it can be served by
nginx or embedded in a Go binary under any route; `base: "./"` is already set.

The studio understands three URL parameters:

```
/studio/?src=/api/topo/docs/42        load document (GET, JSON TopoDoc)
        &save=/api/topo/docs/42      save endpoint (PUT; defaults to src)
        &ret=/network/42             optional "Back" link target
```

- `src` — fetched with `credentials: "include"`, so same-domain deployments
  reuse your session cookies and need no CORS. Response must be a valid
  `TopoDoc`; it replaces the demo document and resets undo history.
- `save` — a **Save** button appears; unsaved edits mark it `Save*` and arm a
  leave-page warning. Saving PUTs the whole document as JSON.
- `ret` — a **← Back** button appears (confirms if there are unsaved changes).

Host-side integration is one link and two handlers:

```
GET /api/topo/docs/42   → 200 application/json  (TopoDoc)
PUT /api/topo/docs/42   ← TopoDoc JSON          (store it; 2xx = saved)
```

A complete stdlib-only Go reference host (static studio + doc store + SSE
feed) lives in [`examples/studio-go-host/`](../examples/studio-go-host/).

Typical flow: your app shows the read-only embed; an **Edit** button opens
`/studio/?src=…&ret=…`; the user edits, saves, and comes back — the embed
re-fetches and renders the updated document.


`examples/embed-plain/` is a complete no-framework host with a fake SSE feed:

```bash
npm run build -ws
node examples/embed-plain/serve.mjs     # → http://localhost:8090
```

Open the page, click **connect SSE**, watch statuses and metrics stream in.
