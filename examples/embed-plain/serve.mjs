// Zero-dependency demo host: serves the plain-HTML page, the standalone
// bundle, and SSE/WebSocket endpoints emitting the same RuntimeEvent JSON.
//   node examples/embed-plain/serve.mjs   →  http://localhost:8090
import { createHash } from "node:crypto";
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

function webSocketTextFrame(text) {
  const payload = Buffer.from(text);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

const server = createServer(async (req, res) => {
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
});

server.on("upgrade", (req, socket) => {
  if (req.url !== "/ws") {
    socket.destroy();
    return;
  }
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.destroy();
    return;
  }
  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );

  const send = (event) => {
    if (socket.writable) socket.write(webSocketTextFrame(JSON.stringify(event)));
  };
  send(snapshotEvent());
  const timer = setInterval(() => send(tickEvent()), 1500);
  const cleanup = () => clearInterval(timer);
  socket.on("data", (chunk) => {
    if ((chunk[0] & 0x0f) !== 0x08) return;
    socket.write(Buffer.from([0x88, 0x00]));
    socket.end();
  });
  socket.on("close", cleanup);
  socket.on("error", cleanup);
});

server.listen(port, () => console.log(`embed demo → http://localhost:${port}`));
