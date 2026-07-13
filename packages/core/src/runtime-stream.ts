import {
  applyRuntimeEvent,
  emptyRuntime,
  type RuntimeEvent,
  type RuntimeState,
} from "./runtime.js";

export type RuntimeConnectionStatus = "connecting" | "open" | "retrying" | "closed";

export interface RuntimeEventStreamOptions {
  /** Starting state; defaults to emptyRuntime(). */
  initial?: RuntimeState;
  /** Fires for every parsed event, before it merges into state. */
  onEvent?: (event: RuntimeEvent) => void;
  /** Fires with the accumulated state after each merge. */
  onState?: (state: RuntimeState) => void;
  /** Malformed messages land here; the stream keeps going. */
  onError?: (error: unknown, raw?: string) => void;
}

export interface RuntimeEventConsumer {
  readonly state: RuntimeState;
  receive(raw: string): void;
}

export function parseRuntimeEventMessage(raw: string): RuntimeEvent {
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("runtime event must be an object");
  }
  const kind = (parsed as { kind?: unknown }).kind;
  if (kind !== "snapshot" && kind !== "node" && kind !== "edge") {
    throw new Error(`unknown runtime event kind: ${String(kind)}`);
  }
  return parsed as RuntimeEvent;
}

/** Shared wire-message parser and state folder used by every live transport. */
export function createRuntimeEventConsumer(
  options: RuntimeEventStreamOptions = {},
): RuntimeEventConsumer {
  let state = options.initial ?? emptyRuntime();

  return {
    get state() {
      return state;
    },
    receive(raw) {
      let event: RuntimeEvent;
      try {
        event = parseRuntimeEventMessage(raw);
      } catch (error) {
        options.onError?.(error, raw);
        return;
      }
      options.onEvent?.(event);
      state = applyRuntimeEvent(state, event);
      options.onState?.(state);
    },
  };
}
