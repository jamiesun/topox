import { describe, expect, it } from "vitest";
import {
  connectRuntimeSSE,
  type EventSourceLike,
  type RuntimeSSEStatus,
  type RuntimeState,
} from "../src/index.js";

class FakeEventSource implements EventSourceLike {
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  closed = false;
  constructor(public url: string) {}
  close() {
    this.closed = true;
  }
  emit(data: unknown) {
    this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) });
  }
}

function setup(options: Parameters<typeof connectRuntimeSSE>[1] = {}) {
  let source!: FakeEventSource;
  const handle = connectRuntimeSSE("http://example/stream", {
    ...options,
    eventSourceFactory: (url) => {
      source = new FakeEventSource(url);
      return source;
    },
  });
  return { handle, source };
}

describe("connectRuntimeSSE", () => {
  it("folds snapshot then patches into state", () => {
    const states: RuntimeState[] = [];
    const { handle, source } = setup({ onState: (s) => states.push(s) });

    source.emit({ kind: "snapshot", state: { nodes: { r1: { status: "running" } }, edges: {} }, ts: 1 });
    source.emit({ kind: "node", key: "r1", patch: { metrics: { cpu: 42 } }, ts: 2 });
    source.emit({ kind: "edge", key: "e1", patch: { metrics: { mbps: 10 } }, ts: 3 });

    expect(handle.state.nodes.r1).toMatchObject({ status: "running", metrics: { cpu: 42 } });
    expect(handle.state.edges.e1?.metrics).toEqual({ mbps: 10 });
    expect(states).toHaveLength(3);
  });

  it("removes entries on null patch", () => {
    const { handle, source } = setup();
    source.emit({ kind: "node", key: "r1", patch: { status: "error" } });
    source.emit({ kind: "node", key: "r1", patch: null });
    expect(handle.state.nodes.r1).toBeUndefined();
  });

  it("reports malformed messages via onError and keeps streaming", () => {
    const errors: string[] = [];
    const { handle, source } = setup({ onError: (_e, raw) => errors.push(raw ?? "") });
    source.emit("{not json");
    source.emit({ kind: "bogus" });
    source.emit({ kind: "node", key: "r1", patch: { status: "running" } });
    expect(errors).toHaveLength(2);
    expect(handle.state.nodes.r1?.status).toBe("running");
  });

  it("tracks status through open, retrying, closed", () => {
    const seen: RuntimeSSEStatus[] = [];
    const { handle, source } = setup({ onStatus: (s) => seen.push(s) });
    expect(handle.status).toBe("connecting");
    source.onopen?.({});
    source.onerror?.({});
    source.onopen?.({});
    handle.close();
    expect(seen).toEqual(["open", "retrying", "open", "closed"]);
    expect(source.closed).toBe(true);
  });

  it("ignores messages after close", () => {
    const { handle, source } = setup();
    handle.close();
    source.emit({ kind: "node", key: "r1", patch: { status: "running" } });
    expect(handle.state.nodes.r1).toBeUndefined();
    handle.close(); // idempotent
    expect(handle.status).toBe("closed");
  });
});
