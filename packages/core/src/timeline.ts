/**
 * RuntimeTimeline — record the event stream, replay any moment.
 *
 * Because RuntimeState only ever changes through RuntimeEvents (pure,
 * immutable apply), history is just the ordered list of events: the state at
 * time T is the fold of every event with ts <= T. This module makes that fold
 * cheap enough for a scrubber UI:
 *
 * - events are pinned with a timestamp at record time, so replay is
 *   deterministic no matter when it runs;
 * - periodic checkpoints bound seek cost to O(checkpointInterval) applies
 *   after a binary search;
 * - a max-events cap folds the oldest events into a base state so long
 *   sessions cannot grow memory without bound (the visible window slides).
 */
import {
  applyRuntimeEvent,
  emptyRuntime,
  type NodeRuntime,
  type RuntimeEvent,
  type RuntimeState,
} from "./runtime.js";
import {
  createRuntimeSnapshot,
  type RuntimeSnapshot,
  type TimestampedRuntimeEvent,
  validateRuntimeSnapshot,
} from "./runtime-snapshot.js";

interface TimelineEntry {
  ts: number;
  event: TimestampedRuntimeEvent;
}

export interface TimelineOptions {
  /** Take a state checkpoint every N events (seek cost bound). Default 50. */
  checkpointInterval?: number;
  /** Keep at most N events; older ones fold into the base state. Default 10000. */
  maxEvents?: number;
}

export interface TimelineRange {
  start: number;
  end: number;
}

/** A retained runtime state update for one node key. */
export interface NodeRuntimeHistoryEntry {
  ts: number;
  key: string;
  /** null marks the point where the runtime producer removed the node state. */
  runtime: NodeRuntime | null;
}

function pinEvent(event: RuntimeEvent, ts: number): TimestampedRuntimeEvent {
  switch (event.kind) {
    case "node":
      return { kind: "node", key: event.key, patch: event.patch, ts };
    case "edge":
      return { kind: "edge", key: event.key, patch: event.patch, ts };
    case "snapshot":
      return { kind: "snapshot", state: event.state, ts };
  }
}

export class RuntimeTimeline {
  private entries: TimelineEntry[] = [];
  /** checkpoints[i] = state after applying entries[0..cpIndex[i]] (inclusive). */
  private checkpoints: { index: number; state: RuntimeState }[] = [];
  private base: RuntimeState = emptyRuntime();
  private readonly checkpointInterval: number;
  private readonly maxEvents: number;

  constructor(options: TimelineOptions = {}) {
    this.checkpointInterval = Math.max(1, options.checkpointInterval ?? 50);
    this.maxEvents = Math.max(this.checkpointInterval * 2, options.maxEvents ?? 10000);
  }

  /** Number of retained events (after any trimming). */
  get length(): number {
    return this.entries.length;
  }

  /** Timestamp span of the retained window, or null when empty. */
  get range(): TimelineRange | null {
    const first = this.entries[0];
    const last = this.entries[this.entries.length - 1];
    if (!first || !last) return null;
    return { start: first.ts, end: last.ts };
  }

  /** Unique retained event timestamps, suitable for frame-by-frame controls. */
  get eventTimestamps(): number[] {
    const timestamps: number[] = [];
    for (const entry of this.entries) {
      if (timestamps[timestamps.length - 1] !== entry.ts) timestamps.push(entry.ts);
    }
    return timestamps;
  }

  /**
   * Append an event. Its timestamp is pinned now (event.ts wins when present)
   * so later replays see exactly what live consumers saw.
   */
  record(event: RuntimeEvent, ts?: number): void {
    const pinned = event.ts ?? ts ?? Date.now();
    const last = this.entries[this.entries.length - 1];
    // guard monotonicity so binary search stays valid
    const finalTs = last && pinned < last.ts ? last.ts : pinned;
    this.append(pinEvent(event, finalTs), true);
  }

  /** A versioned, detached copy of the retained runtime window. */
  toSnapshot(capturedAt = Date.now()): RuntimeSnapshot {
    const events = this.entries.map((entry) => entry.event);
    const first = this.entries[0];
    if (first !== undefined && this.base.ts !== undefined) {
      events.unshift({ kind: "snapshot", state: this.base, ts: first.ts });
    }
    return createRuntimeSnapshot(events, capturedAt);
  }

  /** Replaces this timeline with a previously parsed snapshot. */
  loadSnapshot(snapshot: RuntimeSnapshot): void {
    const detached = validateRuntimeSnapshot(snapshot);
    this.clear();
    // Trim on load too: maxEvents bounds memory regardless of event source.
    for (const event of detached.events) this.append(event, true);
  }

  private append(event: TimestampedRuntimeEvent, trim: boolean): void {
    this.entries.push({ ts: event.ts, event });
    if (this.entries.length % this.checkpointInterval === 0) {
      const index = this.entries.length - 1;
      this.checkpoints.push({ index, state: this.replay(index) });
    }
    if (trim && this.entries.length > this.maxEvents) this.trim();
  }

  /** State as of `ts` (inclusive). Before the window: base state. */
  stateAt(ts: number): RuntimeState {
    // binary search: last entry with entry.ts <= ts
    let lo = 0;
    let hi = this.entries.length - 1;
    let hit = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((this.entries[mid]?.ts ?? Infinity) <= ts) {
        hit = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (hit === -1) return this.base;
    return this.replay(hit);
  }

  /**
   * Returns the retained event history for the requested runtime node keys.
   * Each entry contains the merged state after that event, which makes metric
   * samples and status transitions directly consumable by a trace UI.
   */
  nodeHistory(keys: Iterable<string>): NodeRuntimeHistoryEntry[] {
    const wanted = new Set(keys);
    if (wanted.size === 0) return [];

    const history: NodeRuntimeHistoryEntry[] = [];
    const nodes: Record<string, NodeRuntime> = {};
    for (const key of wanted) {
      const runtime = this.base.nodes[key];
      if (runtime !== undefined) nodes[key] = runtime;
    }
    let state: RuntimeState = { nodes, edges: {} };
    for (const entry of this.entries) {
      if (entry.event.kind === "node") {
        if (!wanted.has(entry.event.key)) continue;
        state = applyRuntimeEvent(state, entry.event);
        history.push({
          ts: entry.ts,
          key: entry.event.key,
          runtime: state.nodes[entry.event.key] ?? null,
        });
      } else if (entry.event.kind === "snapshot") {
        const before = state.nodes;
        const snapshotNodes: Record<string, NodeRuntime> = {};
        for (const key of wanted) {
          const runtime = entry.event.state.nodes[key];
          if (runtime !== undefined) snapshotNodes[key] = runtime;
        }
        state = { nodes: snapshotNodes, edges: {}, ts: entry.ts };
        for (const key of wanted) {
          if (before[key] !== undefined || snapshotNodes[key] !== undefined) {
            history.push({ ts: entry.ts, key, runtime: state.nodes[key] ?? null });
          }
        }
      }
    }
    return history;
  }

  clear(): void {
    this.entries = [];
    this.checkpoints = [];
    this.base = emptyRuntime();
  }

  /** Fold entries[0..index] (inclusive) starting from the nearest checkpoint. */
  private replay(index: number): RuntimeState {
    let state = this.base;
    let from = 0;
    for (let c = this.checkpoints.length - 1; c >= 0; c--) {
      const cp = this.checkpoints[c];
      if (cp && cp.index <= index) {
        state = cp.state;
        from = cp.index + 1;
        break;
      }
    }
    for (let i = from; i <= index; i++) {
      const entry = this.entries[i];
      if (entry) state = applyRuntimeEvent(state, entry.event);
    }
    return state;
  }

  /** Fold the oldest half of the window into the base state. */
  private trim(): void {
    const drop = Math.floor(this.entries.length / 2);
    this.base = this.replay(drop - 1);
    this.entries = this.entries.slice(drop);
    this.checkpoints = this.checkpoints
      .filter((cp) => cp.index >= drop)
      .map((cp) => ({ index: cp.index - drop, state: cp.state }));
  }
}
