export { mountTopoView, type TopoViewHandle, type TopoViewOptions } from "./mount.js";
export { EmbedStore, type EmbedSelection, type EmbedSnapshot } from "./store.js";

// Re-export the pieces hosts typically need without reaching into @topox/core.
export {
  applyDiff,
  connectRuntimeSSE,
  emptyDoc,
  emptyRuntime,
  invertDiff,
  validateDoc,
  type GraphDiff,
  type RuntimeEvent,
  type RuntimeSSEHandle,
  type RuntimeState,
  type TopoDoc,
} from "@topox/core";
