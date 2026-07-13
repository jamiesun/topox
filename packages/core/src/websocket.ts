import {
  createRuntimeEventConsumer,
  type RuntimeConnectionStatus,
  type RuntimeEventStreamOptions,
} from "./runtime-stream.js";
import type { RuntimeState } from "./runtime.js";

export type RuntimeWSStatus = RuntimeConnectionStatus;

/** Minimal native WebSocket surface so hosts and tests can inject one. */
export interface WebSocketLike {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  close(code?: number, reason?: string): void;
}

export interface RuntimeWSOptions extends RuntimeEventStreamOptions {
  onStatus?: (status: RuntimeWSStatus) => void;
  /** Delay before the first reconnect attempt. Defaults to 500ms. */
  reconnectDelayMs?: number;
  /** Exponential-backoff ceiling. Defaults to 10s. */
  maxReconnectDelayMs?: number;
  /** Injectable transport (tests, auth wrappers, polyfills). */
  webSocketFactory?: (url: string) => WebSocketLike;
}

export interface RuntimeWSHandle {
  readonly state: RuntimeState;
  readonly status: RuntimeWSStatus;
  close(): void;
}

function defaultFactory(url: string): WebSocketLike {
  const WS = (globalThis as unknown as {
    WebSocket?: new (socketUrl: string) => WebSocketLike;
  }).WebSocket;
  if (!WS) {
    throw new Error(
      "WebSocket is not available in this environment; pass options.webSocketFactory",
    );
  }
  return new WS(url);
}

function reconnectDelay(value: number | undefined, fallback: number, name: string): number {
  const delay = value ?? fallback;
  if (!Number.isFinite(delay) || delay < 1) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
  return delay;
}

/**
 * Subscribes to RuntimeEvent JSON messages over a native WebSocket.
 * The channel is receive-only; unexpected closes reconnect with bounded backoff.
 */
export function connectRuntimeWS(
  url: string,
  options: RuntimeWSOptions = {},
): RuntimeWSHandle {
  const factory = options.webSocketFactory ?? defaultFactory;
  const initialDelay = reconnectDelay(
    options.reconnectDelayMs,
    500,
    "reconnectDelayMs",
  );
  const maxDelay = reconnectDelay(
    options.maxReconnectDelayMs,
    10_000,
    "maxReconnectDelayMs",
  );
  if (maxDelay < initialDelay) {
    throw new RangeError("maxReconnectDelayMs must be greater than or equal to reconnectDelayMs");
  }

  const consumer = createRuntimeEventConsumer(options);
  let status: RuntimeWSStatus = "connecting";
  let socket: WebSocketLike | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let nextDelay = initialDelay;
  let closed = false;

  const setStatus = (next: RuntimeWSStatus) => {
    if (closed || status === next) return;
    status = next;
    options.onStatus?.(next);
  };

  const scheduleReconnect = () => {
    if (closed || retryTimer !== undefined) return;
    setStatus("retrying");
    const delay = nextDelay;
    nextDelay = Math.min(nextDelay * 2, maxDelay);
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      openSocket(false);
    }, delay);
  };

  const openSocket = (initial: boolean) => {
    let next: WebSocketLike;
    try {
      next = factory(url);
    } catch (error) {
      if (initial) throw error;
      options.onError?.(error);
      scheduleReconnect();
      return;
    }
    socket = next;
    next.onopen = () => {
      if (closed || socket !== next) return;
      nextDelay = initialDelay;
      setStatus("open");
    };
    next.onerror = () => {
      if (closed || socket !== next) return;
      setStatus("retrying");
    };
    next.onclose = () => {
      if (closed || socket !== next) return;
      socket = undefined;
      scheduleReconnect();
    };
    next.onmessage = (event) => {
      if (closed || socket !== next) return;
      if (typeof event.data !== "string") {
        options.onError?.(new Error("WebSocket runtime messages must be JSON text"));
        return;
      }
      consumer.receive(event.data);
    };
  };

  openSocket(true);

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
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      const active = socket;
      socket = undefined;
      active?.close();
      options.onStatus?.("closed");
    },
  };
}
