import {
  createRuntimeEventConsumer,
  type RuntimeConnectionStatus,
  type RuntimeEventStreamOptions,
} from "./runtime-stream.js";
import type { RuntimeState } from "./runtime.js";

/**
 * Wire protocol: each SSE `data:` line is one JSON-encoded RuntimeEvent —
 * `{"kind":"snapshot",...}`, `{"kind":"node",...}` or `{"kind":"edge",...}`.
 * Servers should send a `snapshot` first so late joiners sync in one message.
 * Reconnection is delegated to the platform EventSource.
 */

export type RuntimeSSEStatus = RuntimeConnectionStatus;

/** Minimal EventSource surface so tests and non-browser hosts can inject one. */
export interface EventSourceLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close(): void;
}

export interface RuntimeSSEOptions extends RuntimeEventStreamOptions {
  onStatus?: (status: RuntimeSSEStatus) => void;
  /** Injectable transport (tests, auth wrappers, polyfills). */
  eventSourceFactory?: (url: string) => EventSourceLike;
}

export interface RuntimeSSEHandle {
  readonly state: RuntimeState;
  readonly status: RuntimeSSEStatus;
  close(): void;
}

function defaultFactory(url: string): EventSourceLike {
  const ES = (globalThis as { EventSource?: new (url: string) => EventSourceLike }).EventSource;
  if (!ES) {
    throw new Error(
      "EventSource is not available in this environment; pass options.eventSourceFactory",
    );
  }
  return new ES(url);
}

/**
 * Subscribes to a RuntimeEvent SSE stream and folds it into a RuntimeState.
 * Pure accumulation — pair `handle.state` with resolveRuntime() for rendering.
 */
export function connectRuntimeSSE(
  url: string,
  options: RuntimeSSEOptions = {},
): RuntimeSSEHandle {
  const factory = options.eventSourceFactory ?? defaultFactory;
  const consumer = createRuntimeEventConsumer(options);
  let status: RuntimeSSEStatus = "connecting";
  let closed = false;

  const setStatus = (next: RuntimeSSEStatus) => {
    if (closed || status === next) return;
    status = next;
    options.onStatus?.(next);
  };

  const source = factory(url);
  source.onopen = () => setStatus("open");
  source.onerror = () => setStatus("retrying");
  source.onmessage = (ev) => {
    if (closed) return;
    consumer.receive(ev.data);
  };

  return {
    get state() {
      return consumer.state;
    },
    get status() {
      return status;
    },
    close() {
      if (closed) return;
      closed = true;
      status = "closed";
      source.close();
      options.onStatus?.("closed");
    },
  };
}
