import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectRuntimeWS,
  type RuntimeState,
  type RuntimeWSOptions,
  type RuntimeWSStatus,
  type WebSocketLike,
} from "../src/index.js";

class FakeWebSocket implements WebSocketLike {
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  closeCalls = 0;

  constructor(readonly url: string) {}

  open() {
    this.onopen?.({});
  }

  emit(data: unknown) {
    this.onmessage?.({
      data: typeof data === "string" ? data : JSON.stringify(data),
    });
  }

  emitRaw(data: unknown) {
    this.onmessage?.({ data });
  }

  disconnect() {
    this.onclose?.({});
  }

  close() {
    this.closeCalls += 1;
  }
}

function setup(options: RuntimeWSOptions = {}) {
  const sockets: FakeWebSocket[] = [];
  const handle = connectRuntimeWS("ws://example/runtime", {
    reconnectDelayMs: 100,
    maxReconnectDelayMs: 400,
    ...options,
    webSocketFactory: (url) => {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
  });
  return { handle, sockets };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("connectRuntimeWS", () => {
  it("folds the shared snapshot and patch message format into runtime state", () => {
    const states: RuntimeState[] = [];
    const { handle, sockets } = setup({ onState: (state) => states.push(state) });
    const socket = sockets[0]!;
    expect(socket.url).toBe("ws://example/runtime");

    socket.open();
    socket.emit({
      kind: "snapshot",
      state: { nodes: { r1: { status: "running" } }, edges: {} },
      ts: 1,
    });
    socket.emit({ kind: "node", key: "r1", patch: { metrics: { cpu: 42 } }, ts: 2 });
    socket.emit({ kind: "edge", key: "e1", patch: { metrics: { mbps: 10 } }, ts: 3 });

    expect(handle.state.nodes.r1).toMatchObject({
      status: "running",
      metrics: { cpu: 42 },
    });
    expect(handle.state.edges.e1?.metrics).toEqual({ mbps: 10 });
    expect(states).toHaveLength(3);
  });

  it("reports malformed text and binary messages, then keeps streaming", () => {
    const errors: { raw?: string }[] = [];
    const { handle, sockets } = setup({
      onError: (_error, raw) => errors.push(raw === undefined ? {} : { raw }),
    });
    const socket = sockets[0]!;

    socket.emit("{not json");
    socket.emit({ kind: "bogus" });
    socket.emitRaw(new Uint8Array([1, 2, 3]));
    socket.emit({ kind: "node", key: "r1", patch: { status: "running" }, ts: 4 });

    expect(errors).toEqual([{ raw: "{not json" }, { raw: '{"kind":"bogus"}' }, {}]);
    expect(handle.state.nodes.r1?.status).toBe("running");
  });

  it("reconnects with bounded backoff and closes idempotently", async () => {
    vi.useFakeTimers();
    const statuses: RuntimeWSStatus[] = [];
    const { handle, sockets } = setup({ onStatus: (status) => statuses.push(status) });
    expect(handle.status).toBe("connecting");

    sockets[0]!.open();
    sockets[0]!.disconnect();
    expect(handle.status).toBe("retrying");
    await vi.advanceTimersByTimeAsync(99);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(2);

    sockets[1]!.disconnect();
    await vi.advanceTimersByTimeAsync(199);
    expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(3);
    sockets[2]!.open();

    handle.close();
    handle.close();
    expect(handle.status).toBe("closed");
    expect(sockets[2]!.closeCalls).toBe(1);
    sockets[2]!.emit({ kind: "node", key: "late", patch: { status: "error" } });
    sockets[2]!.disconnect();
    await vi.runAllTimersAsync();

    expect(handle.state.nodes.late).toBeUndefined();
    expect(sockets).toHaveLength(3);
    expect(statuses).toEqual(["open", "retrying", "open", "closed"]);
  });
});
