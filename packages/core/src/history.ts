import { applyDiff, invertDiff } from "./diff.js";
import type { GraphDiff, TopoDoc } from "./types.js";

/**
 * Linear diff history. Apply pushes, undo/redo walk the cursor.
 * Because every change is an invertible GraphDiff, this is the whole implementation.
 */
export class History {
  private entries: GraphDiff[] = [];
  private cursor = 0; // number of applied entries
  private current: TopoDoc;

  constructor(initial: TopoDoc) {
    this.current = initial;
  }

  get doc(): TopoDoc {
    return this.current;
  }

  get canUndo(): boolean {
    return this.cursor > 0;
  }

  get canRedo(): boolean {
    return this.cursor < this.entries.length;
  }

  /** Applied entries, oldest first. */
  get applied(): readonly GraphDiff[] {
    return this.entries.slice(0, this.cursor);
  }

  /** Applies a diff and records it, discarding any redo tail. */
  apply(diff: GraphDiff): TopoDoc {
    if (diff.ops.length === 0) return this.current;
    this.current = applyDiff(this.current, diff);
    this.entries = this.entries.slice(0, this.cursor);
    this.entries.push(diff);
    this.cursor += 1;
    return this.current;
  }

  undo(): TopoDoc {
    if (!this.canUndo) return this.current;
    const diff = this.entries[this.cursor - 1]!;
    this.current = applyDiff(this.current, invertDiff(diff));
    this.cursor -= 1;
    return this.current;
  }

  redo(): TopoDoc {
    if (!this.canRedo) return this.current;
    const diff = this.entries[this.cursor]!;
    this.current = applyDiff(this.current, diff);
    this.cursor += 1;
    return this.current;
  }
}
