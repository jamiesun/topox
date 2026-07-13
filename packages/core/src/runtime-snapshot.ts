import type {
  EdgeRuntime,
  NodeRuntime,
  NodeStatus,
  RuntimeEvent,
  RuntimeState,
} from "./runtime.js";

export const RUNTIME_SNAPSHOT_FORMAT = "topox-runtime-snapshot";
export const RUNTIME_SNAPSHOT_VERSION = 1;

export type TimestampedRuntimeEvent = RuntimeEvent & { ts: number };

export interface RuntimeSnapshot {
  format: typeof RUNTIME_SNAPSHOT_FORMAT;
  version: typeof RUNTIME_SNAPSHOT_VERSION;
  capturedAt: number;
  range: { start: number; end: number } | null;
  events: TimestampedRuntimeEvent[];
}

type JsonObject = Record<string, unknown>;

const NODE_STATUSES = new Set<NodeStatus>([
  "running",
  "waiting",
  "stopped",
  "error",
  "offline",
]);

function invalid(path: string, message: string): never {
  throw new Error(`invalid runtime snapshot: ${path} ${message}`);
}

function assertObject(value: unknown, path: string): asserts value is JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid(path, "must be an object");
  }
}

function assertFiniteNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid(path, "must be a finite number");
  }
}

function assertOptionalTimestamp(value: unknown, path: string): void {
  if (value !== undefined) assertFiniteNumber(value, path);
}

function assertMetrics(value: unknown, path: string): void {
  assertObject(value, path);
  for (const [key, metric] of Object.entries(value)) {
    if (
      typeof metric !== "string" &&
      (typeof metric !== "number" || !Number.isFinite(metric))
    ) {
      invalid(`${path}.${key}`, "must be a string or finite number");
    }
  }
}

function assertNodeRuntime(value: unknown, path: string): asserts value is NodeRuntime {
  assertObject(value, path);
  if (
    value["status"] !== undefined &&
    (typeof value["status"] !== "string" || !NODE_STATUSES.has(value["status"] as NodeStatus))
  ) {
    invalid(`${path}.status`, "is not a supported node status");
  }
  if (value["message"] !== undefined && typeof value["message"] !== "string") {
    invalid(`${path}.message`, "must be a string");
  }
  if (value["metrics"] !== undefined) assertMetrics(value["metrics"], `${path}.metrics`);
  assertOptionalTimestamp(value["updatedAt"], `${path}.updatedAt`);
}

function assertEdgeRuntime(value: unknown, path: string): asserts value is EdgeRuntime {
  assertObject(value, path);
  if (value["active"] !== undefined && typeof value["active"] !== "boolean") {
    invalid(`${path}.active`, "must be a boolean");
  }
  if (value["metrics"] !== undefined) assertMetrics(value["metrics"], `${path}.metrics`);
  assertOptionalTimestamp(value["updatedAt"], `${path}.updatedAt`);
}

function assertRuntimeState(value: unknown, path: string): asserts value is RuntimeState {
  assertObject(value, path);
  assertObject(value["nodes"], `${path}.nodes`);
  for (const [key, runtime] of Object.entries(value["nodes"])) {
    assertNodeRuntime(runtime, `${path}.nodes.${key}`);
  }
  assertObject(value["edges"], `${path}.edges`);
  for (const [key, runtime] of Object.entries(value["edges"])) {
    assertEdgeRuntime(runtime, `${path}.edges.${key}`);
  }
  assertOptionalTimestamp(value["ts"], `${path}.ts`);
}

function assertRuntimeEvent(
  value: unknown,
  path: string,
): asserts value is TimestampedRuntimeEvent {
  assertObject(value, path);
  assertFiniteNumber(value["ts"], `${path}.ts`);

  switch (value["kind"]) {
    case "node":
      if (typeof value["key"] !== "string" || value["key"] === "") {
        invalid(`${path}.key`, "must be a non-empty string");
      }
      if (value["patch"] !== null) assertNodeRuntime(value["patch"], `${path}.patch`);
      return;
    case "edge":
      if (typeof value["key"] !== "string" || value["key"] === "") {
        invalid(`${path}.key`, "must be a non-empty string");
      }
      if (value["patch"] !== null) assertEdgeRuntime(value["patch"], `${path}.patch`);
      return;
    case "snapshot":
      assertRuntimeState(value["state"], `${path}.state`);
      return;
    default:
      invalid(`${path}.kind`, "must be node, edge, or snapshot");
  }
}

function assertRuntimeSnapshot(value: unknown): asserts value is RuntimeSnapshot {
  assertObject(value, "root");
  if (value["format"] !== RUNTIME_SNAPSHOT_FORMAT) {
    invalid("format", `must be "${RUNTIME_SNAPSHOT_FORMAT}"`);
  }
  if (value["version"] !== RUNTIME_SNAPSHOT_VERSION) {
    throw new Error(`unsupported runtime snapshot version: ${String(value["version"])}`);
  }
  assertFiniteNumber(value["capturedAt"], "capturedAt");
  if (!Array.isArray(value["events"])) invalid("events", "must be an array");
  value["events"].forEach((event, index) => assertRuntimeEvent(event, `events[${index}]`));

  const events = value["events"] as TimestampedRuntimeEvent[];
  for (let index = 1; index < events.length; index++) {
    if (events[index]!.ts < events[index - 1]!.ts) {
      invalid(`events[${index}].ts`, "must be monotonic");
    }
  }

  if (events.length === 0) {
    if (value["range"] !== null) invalid("range", "must be null when events is empty");
    return;
  }

  assertObject(value["range"], "range");
  assertFiniteNumber(value["range"]["start"], "range.start");
  assertFiniteNumber(value["range"]["end"], "range.end");
  const first = events[0]!.ts;
  const last = events[events.length - 1]!.ts;
  if (value["range"]["start"] !== first || value["range"]["end"] !== last) {
    invalid("range", "does not match event timestamps");
  }
}

function cloneNodeRuntime(runtime: NodeRuntime): NodeRuntime {
  return {
    ...runtime,
    ...(runtime.metrics !== undefined ? { metrics: { ...runtime.metrics } } : {}),
  };
}

function cloneEdgeRuntime(runtime: EdgeRuntime): EdgeRuntime {
  return {
    ...runtime,
    ...(runtime.metrics !== undefined ? { metrics: { ...runtime.metrics } } : {}),
  };
}

function cloneRuntimeState(state: RuntimeState): RuntimeState {
  return {
    nodes: Object.fromEntries(
      Object.entries(state.nodes).map(([key, runtime]) => [key, cloneNodeRuntime(runtime)]),
    ),
    edges: Object.fromEntries(
      Object.entries(state.edges).map(([key, runtime]) => [key, cloneEdgeRuntime(runtime)]),
    ),
    ...(state.ts !== undefined ? { ts: state.ts } : {}),
  };
}

function cloneEvent(event: TimestampedRuntimeEvent): TimestampedRuntimeEvent {
  switch (event.kind) {
    case "node":
      return {
        kind: "node",
        key: event.key,
        patch: event.patch === null ? null : cloneNodeRuntime(event.patch),
        ts: event.ts,
      };
    case "edge":
      return {
        kind: "edge",
        key: event.key,
        patch: event.patch === null ? null : cloneEdgeRuntime(event.patch),
        ts: event.ts,
      };
    case "snapshot":
      return { kind: "snapshot", state: cloneRuntimeState(event.state), ts: event.ts };
  }
}

export function createRuntimeSnapshot(
  events: readonly TimestampedRuntimeEvent[],
  capturedAt = Date.now(),
): RuntimeSnapshot {
  const copiedEvents = events.map(cloneEvent);
  const snapshot: RuntimeSnapshot = {
    format: RUNTIME_SNAPSHOT_FORMAT,
    version: RUNTIME_SNAPSHOT_VERSION,
    capturedAt,
    range:
      copiedEvents.length === 0
        ? null
        : { start: copiedEvents[0]!.ts, end: copiedEvents[copiedEvents.length - 1]!.ts },
    events: copiedEvents,
  };
  assertRuntimeSnapshot(snapshot);
  return snapshot;
}

export function serializeRuntimeSnapshot(snapshot: RuntimeSnapshot): string {
  return JSON.stringify(validateRuntimeSnapshot(snapshot), null, 2);
}

export function validateRuntimeSnapshot(value: unknown): RuntimeSnapshot {
  assertRuntimeSnapshot(value);
  return createRuntimeSnapshot(value.events, value.capturedAt);
}

export function parseRuntimeSnapshot(raw: string): RuntimeSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(
      `invalid runtime snapshot JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return validateRuntimeSnapshot(parsed);
}
