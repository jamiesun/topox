# @talkincode/topox-dsl

Line-oriented TopoX DSL compiler and serializer. The DSL compiles to `GraphDiff` so AI or text workflows can stage changes before a user applies them.

## Install

```sh
npm install @talkincode/topox-dsl @talkincode/topox-core
```

## Usage

```ts
import { emptyDoc } from "@talkincode/topox-core";
import { compileDsl, docToDsl } from "@talkincode/topox-dsl";

const doc = emptyDoc();
const source = docToDsl(doc);
const result = compileDsl(source, doc);

if (result.ok) {
  console.log(result.diff.ops);
}
```

Use this package when you need text-to-topology editing through the TopoX diff pipeline.

