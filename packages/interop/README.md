# @talkincode/topox-interop

Import and export helpers for TopoX documents. Supported formats include YAML, Mermaid, Graphviz DOT, and GraphML.

## Install

```sh
npm install @talkincode/topox-interop @talkincode/topox-core
```

## Usage

```ts
import { docToYaml, parseMermaid } from "@talkincode/topox-interop";

const parsed = parseMermaid("graph TD\n  A-->B");

if (parsed.ok) {
  console.log(docToYaml(parsed.doc));
}
```

All imports return or validate TopoX `TopoDoc` data before it enters the rest of the system.

