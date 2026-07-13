import {
  History,
  applyRuntimeEvent,
  emptyDoc,
  emptyRuntime,
  resolveRuntime,
  type GraphDiff,
  type ResolvedRuntime,
  type RuntimeEvent,
  type RuntimeState,
  type TopoDoc,
} from "@topox/core";

export interface EmbedSelection {
  nodeIds: string[];
  edgeIds: string[];
  groupIds: string[];
}

export interface EmbedSnapshot {
  doc: TopoDoc;
  viewId: string;
  readOnly: boolean;
  runtime: ResolvedRuntime | undefined;
  selection: EmbedSelection;
}

/**
 * Tiny external store the React layer subscribes to via useSyncExternalStore.
 * All mutations funnel through here so the imperative handle and the React
 * tree always agree.
 */
export class EmbedStore {
  private history: History;
  private viewId: string;
  private readOnly: boolean;
  private runtimeState: RuntimeState = emptyRuntime();
  private hasRuntime = false;
  private selection: EmbedSelection = { nodeIds: [], edgeIds: [], groupIds: [] };
  private listeners = new Set<() => void>();
  private snapshot: EmbedSnapshot;

  constructor(doc: TopoDoc | undefined, viewId: string | undefined, readOnly: boolean) {
    const initial = doc ?? emptyDoc("topox");
    this.history = new History(initial);
    this.viewId = viewId ?? initial.views[0]?.id ?? "default";
    this.readOnly = readOnly;
    this.snapshot = this.compute();
  }

  private compute(): EmbedSnapshot {
    const doc = this.history.doc;
    return {
      doc,
      viewId: this.viewId,
      readOnly: this.readOnly,
      runtime: this.hasRuntime ? resolveRuntime(doc, this.runtimeState) : undefined,
      selection: this.selection,
    };
  }

  private emit() {
    this.snapshot = this.compute();
    for (const fn of this.listeners) fn();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): EmbedSnapshot => this.snapshot;

  get doc(): TopoDoc {
    return this.history.doc;
  }

  get currentViewId(): string {
    return this.viewId;
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  get runtime(): RuntimeState {
    return this.runtimeState;
  }

  setDoc(doc: TopoDoc, viewId?: string) {
    this.history = new History(doc);
    this.viewId = viewId ?? doc.views[0]?.id ?? this.viewId;
    this.emit();
  }

  setView(viewId: string) {
    this.viewId = viewId;
    this.emit();
  }

  applyDiff(diff: GraphDiff): TopoDoc {
    const doc = this.history.apply(diff);
    this.emit();
    return doc;
  }

  undo(): TopoDoc {
    const doc = this.history.undo();
    this.emit();
    return doc;
  }

  redo(): TopoDoc {
    const doc = this.history.redo();
    this.emit();
    return doc;
  }

  setReadOnly(readOnly: boolean) {
    this.readOnly = readOnly;
    this.emit();
  }

  setSelection(selection: EmbedSelection) {
    this.selection = selection;
    this.emit();
  }

  pushRuntimeEvent(event: RuntimeEvent) {
    this.runtimeState = applyRuntimeEvent(this.runtimeState, event);
    this.hasRuntime = true;
    this.emit();
  }

  setRuntimeState(state: RuntimeState) {
    this.runtimeState = state;
    this.hasRuntime = true;
    this.emit();
  }

  clearRuntime() {
    this.runtimeState = emptyRuntime();
    this.hasRuntime = false;
    this.emit();
  }
}
