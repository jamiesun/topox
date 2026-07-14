# @talkincode/topox-embed

Framework-agnostic DOM embed for TopoX. It mounts a bundled React canvas into any host page and exposes an imperative handle.

## Install

```sh
npm install @talkincode/topox-embed
```

## Usage

```ts
import { mountTopoView } from "@talkincode/topox-embed";

const handle = mountTopoView(document.getElementById("topox")!, {
  doc,
  onDiff(diff) {
    console.log(diff.ops);
  },
});

handle.autoLayout();
```

The package also publishes `@talkincode/topox-embed/standalone` for hosts that need the prebuilt standalone bundle.

