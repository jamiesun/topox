# @talkincode/topox-editor

React canvas components and conversion helpers for rendering and editing TopoX documents. The editor is a controlled view: documents go in, `GraphDiff` objects come out.

## Install

```sh
npm install @talkincode/topox-editor @talkincode/topox-core @xyflow/react react react-dom
```

## Usage

```tsx
import { TopoCanvas } from "@talkincode/topox-editor";

export function Diagram({ doc, runtime, onDiff }) {
  return <TopoCanvas doc={doc} runtime={runtime} onDiff={onDiff} />;
}
```

The package also exports layout helpers and icon utilities used by the TopoX studio and embed packages.

