# @talkincode/topox-core

Core graph model, validation, diff engine, runtime overlays, history, and transport helpers for TopoX.

## Install

```sh
npm install @talkincode/topox-core
```

## Usage

```ts
import { applyDiff, emptyDoc, validateDoc } from "@talkincode/topox-core";

const doc = emptyDoc();
const issues = validateDoc(doc);

if (issues.length === 0) {
  const next = applyDiff(doc, { ops: [] });
  console.log(next.schemaVersion);
}
```

`@talkincode/topox-core` has no runtime dependencies and keeps the document model JSON-serializable.

