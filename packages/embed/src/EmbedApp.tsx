import { TopoCanvas } from "@talkincode/topox-editor";
import { useSyncExternalStore } from "react";
import type { GraphDiff } from "@talkincode/topox-core";
import type { EmbedStore } from "./store.js";

export interface EmbedAppProps {
  store: EmbedStore;
  onDiff: (diff: GraphDiff) => void;
  onSelect: (nodeIds: string[], edgeIds: string[], groupIds?: string[]) => void;
}

export function EmbedApp({ store, onDiff, onSelect }: EmbedAppProps) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return (
    <div style={{ width: "100%", height: "100%" }}>
      <TopoCanvas
        doc={snap.doc}
        viewId={snap.viewId}
        onDiff={onDiff}
        onSelect={onSelect}
        readOnly={snap.readOnly}
        {...(snap.runtime !== undefined ? { runtime: snap.runtime } : {})}
      />
    </div>
  );
}
