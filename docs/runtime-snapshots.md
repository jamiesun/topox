# Runtime snapshot format

Runtime snapshots preserve a bounded `RuntimeEvent` window for offline replay.
They are separate from `TopoDoc`: a snapshot contains no graph, view, layout,
diff, or edit-history data.

The Studio saves these files as `*.topox-runtime.json`. Use **File -> Save
runtime snapshot**, then **File -> Load runtime snapshot...** to restore the
window after a refresh. Loading starts at the first retained frame; the
Timeline can scrub, play/pause, or step to the previous/next event timestamp.

## Version 1 schema

```json
{
  "format": "topox-runtime-snapshot",
  "version": 1,
  "capturedAt": 1783956000000,
  "range": {
    "start": 1783955990000,
    "end": 1783956000000
  },
  "events": [
    {
      "kind": "node",
      "key": "dev:fw-01",
      "patch": {
        "status": "running",
        "metrics": { "cpu": 12, "latency_ms": 8 }
      },
      "ts": 1783955990000
    },
    {
      "kind": "edge",
      "key": "e1",
      "patch": { "active": true, "metrics": { "mbps": 940 } },
      "ts": 1783956000000
    }
  ]
}
```

| Field | Contract |
| --- | --- |
| `format` | Literal `topox-runtime-snapshot`. |
| `version` | Integer `1`. Unknown versions are rejected rather than guessed. |
| `capturedAt` | Finite Unix timestamp in milliseconds when the file was created. |
| `range` | `null` for no events; otherwise exactly the first and last event timestamps. |
| `events` | Monotonic, timestamped `RuntimeEvent` values. Every event must include `ts`. |

The event payload is the same contract used by live runtime transports:

- `node`: `{ kind, key, patch, ts }`, where `patch` is `NodeRuntime` or `null`;
- `edge`: `{ kind, key, patch, ts }`, where `patch` is `EdgeRuntime` or `null`;
- `snapshot`: `{ kind, state, ts }`, where `state` is a complete
  `{ nodes, edges, ts? }` runtime state.

Node statuses are `running`, `waiting`, `stopped`, `error`, or `offline`.
Metric values are finite numbers or strings. A node key should match
`Node.ref` when one exists, otherwise the node id.

When a long-running Timeline has already trimmed old events, export may place a
synthetic `snapshot` event at the beginning of the retained window. This keeps
the folded base state intact without exporting events outside the bounded
window.

## Core API

```ts
import {
  RuntimeTimeline,
  parseRuntimeSnapshot,
  serializeRuntimeSnapshot,
} from "@topox/core";

const timeline = new RuntimeTimeline();
timeline.record(runtimeEvent);

const json = serializeRuntimeSnapshot(timeline.toSnapshot());

const restored = new RuntimeTimeline();
restored.loadSnapshot(parseRuntimeSnapshot(json));
const firstFrame = restored.range?.start;
```

`parseRuntimeSnapshot` validates JSON shape, version, event payloads,
timestamp ordering, and range metadata before returning. `loadSnapshot`
detaches and validates the replacement before clearing the current Timeline,
so an invalid file cannot partially replace active runtime state.
