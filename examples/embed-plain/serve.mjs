// Zero-dependency demo host: serves the plain-HTML page, the standalone
// bundle, and a `/stream` SSE endpoint emitting RuntimeEvent JSON.
//   node examples/embed-plain/serve.mjs   →  http://localhost:8090
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bundle = join(here, "../../packages/embed/dist/topox-embed.standalone.js");
const port = Number(process.env.PORT ?? 8090);

const REFS = ["dev:fw-01", "dev:core-01", "dev:sw-01", "svc:acs", "cpe:1001", "cpe:1002"];
const STATUSES = ["running", "running", "running", "waiting", "error", "offline"];
const rnd = (n) => Math.round(Math.random() * n);

function snapshotEvent() {
  const nodes = {};
  for (const ref of REFS) {
    nodes[ref] = { status: "running", metrics: { cpu: rnd(90), mem: rnd(80) } };
  }
  return { kind: "snapshot", state: { nodes, edges: {} }, ts: Date.now() };
}

function tickEvent() {
  const ref = REFS[rnd(REFS.length - 1)];
  return {
    kind: "node",
    key: ref,
    patch: {
      status: STATUSES[rnd(STATUSES.length - 1)],
      metrics: { cpu: rnd(95), latency: rnd(300) },
    },
    ts: Date.now(),
  };
}

createServer(async (req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(await readFile(join(here, "index.html")));
    return;
  }
  if (req.url === "/topox-embed.standalone.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(await readFile(bundle));
    return;
  }
  if (req.url === "/stream") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify(snapshotEvent())}\n\n`);
    const timer = setInterval(() => {
      res.write(`data: ${JSON.stringify(tickEvent())}\n\n`);
    }, 1500);
    req.on("close", () => clearInterval(timer));
    return;
  }
  res.writeHead(404).end("not found");
}).listen(port, () => console.log(`embed demo → http://localhost:${port}`));
