import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import {
  connectRuntimeSSE,
  type GraphDiff,
  type RuntimeEvent,
  type RuntimeSSEHandle,
  type RuntimeSSEOptions,
  type RuntimeState,
  type TopoDoc,
} from "@topox/core";
import { autoLayoutDiff, type AutoLayoutOptions } from "@topox/editor";
import { EmbedApp } from "./EmbedApp.js";
import { EmbedStore, type EmbedSelection } from "./store.js";
// Bundled as text by build.mjs; injected once per document.
import flowCss from "@xyflow/react/dist/style.css";

export interface TopoViewOptions {
  /** Initial document. Defaults to an empty one. */
  doc?: TopoDoc;
  /** View whose layout to render. Defaults to the doc's first view. */
  viewId?: string;
  /** Viewer by default; set false to allow editing. */
  readOnly?: boolean;
  /** Convenience: opens a RuntimeEvent SSE stream immediately. */
  runtimeUrl?: string;
  /** Fires after each canvas edit has been applied to the internal history. */
  onDiff?: (diff: GraphDiff, doc: TopoDoc) => void;
  onSelect?: (selection: EmbedSelection) => void;
  onRuntimeState?: (state: RuntimeState) => void;
  onRuntimeStatus?: (status: string) => void;
}

export interface TopoViewHandle {
  /** Current document (immutable value; a new one after every change). */
  getDoc(): TopoDoc;
  /** Replaces the document and resets undo history. */
  setDoc(doc: TopoDoc, viewId?: string): void;
  /** Applies a GraphDiff through the same pipeline canvas edits use. */
  applyDiff(diff: GraphDiff): TopoDoc;
  undo(): TopoDoc;
  redo(): TopoDoc;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Dagre auto-layout on the active view (recorded in history). */
  autoLayout(options?: AutoLayoutOptions): void;
  setReadOnly(readOnly: boolean): void;
  /** Feeds one runtime event (status/metrics overlay). */
  pushRuntimeEvent(event: RuntimeEvent): void;
  /** Replaces the whole runtime overlay state. */
  setRuntimeState(state: RuntimeState): void;
  clearRuntime(): void;
  /** Connects an SSE stream; closes any previous one. Returns its handle. */
  connectSSE(url: string, options?: RuntimeSSEOptions): RuntimeSSEHandle;
  /** Unmounts, closes streams, removes listeners. */
  destroy(): void;
}

const STYLE_TAG_ID = "topox-embed-style";

function ensureStyles(doc: Document) {
  if (doc.getElementById(STYLE_TAG_ID)) return;
  const tag = doc.createElement("style");
  tag.id = STYLE_TAG_ID;
  tag.textContent = flowCss;
  doc.head.appendChild(tag);
}

/**
 * Mounts a TopoX canvas into `el` and returns an imperative handle.
 * No React knowledge required on the host side.
 */
export function mountTopoView(el: HTMLElement, options: TopoViewOptions = {}): TopoViewHandle {
  ensureStyles(el.ownerDocument);
  if (!el.style.height && el.clientHeight === 0) el.style.height = "480px";

  const store = new EmbedStore(options.doc, options.viewId, options.readOnly ?? true);
  let sse: RuntimeSSEHandle | undefined;
  let root: Root | undefined = createRoot(el);

  const handleDiff = (diff: GraphDiff) => {
    const doc = store.applyDiff(diff);
    options.onDiff?.(diff, doc);
  };
  const handleSelect = (nodeIds: string[], edgeIds: string[], groupIds?: string[]) => {
    const selection: EmbedSelection = { nodeIds, edgeIds, groupIds: groupIds ?? [] };
    store.setSelection(selection);
    options.onSelect?.(selection);
  };

  root.render(createElement(EmbedApp, { store, onDiff: handleDiff, onSelect: handleSelect }));

  const connectSSE = (url: string, sseOptions: RuntimeSSEOptions = {}): RuntimeSSEHandle => {
    sse?.close();
    sse = connectRuntimeSSE(url, {
      ...sseOptions,
      initial: sseOptions.initial ?? store.runtime,
      onState: (state) => {
        store.setRuntimeState(state);
        sseOptions.onState?.(state);
        options.onRuntimeState?.(state);
      },
      onStatus: (status) => {
        sseOptions.onStatus?.(status);
        options.onRuntimeStatus?.(status);
      },
    });
    return sse;
  };

  if (options.runtimeUrl) connectSSE(options.runtimeUrl);

  return {
    getDoc: () => store.doc,
    setDoc: (doc, viewId) => store.setDoc(doc, viewId),
    applyDiff: (diff) => {
      const doc = store.applyDiff(diff);
      options.onDiff?.(diff, doc);
      return doc;
    },
    undo: () => store.undo(),
    redo: () => store.redo(),
    canUndo: () => store.canUndo,
    canRedo: () => store.canRedo,
    autoLayout: (layoutOptions) => {
      const diff = autoLayoutDiff(store.doc, store.currentViewId, layoutOptions);
      if (diff.ops.length > 0) {
        const doc = store.applyDiff(diff);
        options.onDiff?.(diff, doc);
      }
    },
    setReadOnly: (readOnly) => store.setReadOnly(readOnly),
    pushRuntimeEvent: (event) => store.pushRuntimeEvent(event),
    setRuntimeState: (state) => store.setRuntimeState(state),
    clearRuntime: () => store.clearRuntime(),
    connectSSE,
    destroy: () => {
      sse?.close();
      sse = undefined;
      root?.unmount();
      root = undefined;
    },
  };
}
