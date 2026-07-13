/**
 * Demo runtime producer — emits RuntimeEvents the way a real collector
 * (SNMP poller, Prometheus bridge, WebSocket feed) would. Keys nodes by
 * `ref` when present, exactly like production producers should.
 */
import type { RuntimeEvent, RuntimeState, TopoDoc } from "@topox/core";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function walk(prev: number | undefined, base: number, spread: number, lo: number, hi: number): number {
  const start = prev ?? base + (Math.random() - 0.5) * spread;
  return +clamp(start + (Math.random() - 0.5) * spread, lo, hi).toFixed(1);
}

export function simulateTick(doc: TopoDoc, state: RuntimeState): RuntimeEvent[] {
  const events: RuntimeEvent[] = [];

  for (const node of doc.graph.nodes) {
    const key = node.ref ?? node.id;
    const prev = state.nodes[key];
    const prevCpu = typeof prev?.metrics?.["cpu"] === "number" ? prev.metrics["cpu"] : undefined;
    const prevLat = typeof prev?.metrics?.["lat_ms"] === "number" ? prev.metrics["lat_ms"] : undefined;

    // sticky status: errors persist a few ticks, otherwise mostly running
    let status = prev?.status ?? "running";
    const roll = Math.random();
    if (status === "error" || status === "offline") {
      if (roll < 0.35) status = "running";
    } else if (roll < 0.04) status = "error";
    else if (roll < 0.07) status = "waiting";
    else if (roll < 0.09) status = "offline";
    else status = "running";

    events.push({
      kind: "node",
      key,
      patch: {
        status,
        ...(status === "error" ? { message: "health check failed" } : { message: "" }),
        metrics: {
          cpu: walk(prevCpu, 30, 16, 2, 98),
          lat_ms: walk(prevLat, 18, 10, 1, 400),
        },
      },
    });
  }

  for (const edge of doc.graph.edges) {
    const prev = state.edges[edge.id];
    const prevQps = typeof prev?.metrics?.["qps"] === "number" ? prev.metrics["qps"] : undefined;
    const active = Math.random() > 0.25;
    events.push({
      kind: "edge",
      key: edge.id,
      patch: active
        ? { active: true, metrics: { qps: walk(prevQps, 120, 60, 0, 2000) } }
        : { active: false },
    });
  }

  return events;
}
