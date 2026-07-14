# TopoX 插件 API 边界（草案）

> 状态：Draft，仅供 API 评审。本文不代表插件系统已经实现。

## 1. 审计结论

**ACCEPT，但只接受最小的宿主级插件目录。**

当前扩展痛点是真实的：

- `packages/editor/src/TopoCanvas.tsx` 用 `typePalette` 硬编码节点类型外观；
- `apps/studio/src/Inspector.tsx` 只能用通用 attrs/JSON 编辑器处理领域属性；
- `packages/editor/src/layout.ts` 与 Studio/embed 都直接依赖 dagre；
- `apps/studio/src/App.tsx` 靠扩展名分支和静态菜单接入文件格式。

继续为每个领域和格式增加分支，会迫使第三方修改 TopoX 源码。但当前没有插件热
插拔、远程分发、生命周期编排或不可信代码执行的产品证据，因此本设计明确拒绝：

- 全局 `registerPlugin()` 单例；
- URL 远程加载、插件市场、自动发现；
- 启动后的热添加/卸载；
- 插件直接提供任意 React 渲染组件；
- 把插件或 Schema 写入 `TopoDoc`；
- 在 `@talkincode/topox-core` 中加入领域校验或插件依赖。

低成本路径是：插件仍由 npm/本地 ESM 分发，Studio 或 embed 在启动时显式注册，
每个宿主实例拥有独立且随后封存的目录。它解决现有硬编码问题，但不提前建设插件
平台。

## 2. 不变边界

1. `@talkincode/topox-core` 继续只认识
   `Graph/Node/Edge/Group/View/RuntimeState` 六个核心数据对象；`GraphDiff`
   继续只是唯一修改协议。core 保持零运行时依赖。
2. `Node.type` 仍是开放字符串。未注册类型合法，并使用通用节点与 Inspector。
3. 节点 Schema、布局器、格式适配器都是宿主能力，不进入文档、History 或导出。
4. 插件不能持有文档写句柄。编辑结果只能由宿主通过 `GraphDiff` 应用。
5. 布局只能修改 View；Runtime 仍不能进入任何文档导出。
6. 整文档导入仍是唯一不产生 diff 的替换入口，并且必须先通过结构和插件校验。
7. v1 插件是宿主安装的可信进程内代码，不是安全沙箱。

## 3. 包与所有权

后续实现建议新增轻量的 `@talkincode/topox-plugin-api` 包：

- 只依赖 `@talkincode/topox-core` 的类型和纯函数；
- 定义下文契约、冲突检测和调用结果校验；
- 不依赖 React、Studio、dagre、XML/YAML 解析器；
- 不保存全局状态。

`@talkincode/topox-editor` 和 `@talkincode/topox-interop` 可导出内置能力的插件适配器。Studio 与 embed
各自创建目录并负责调用、错误展示和最终状态提交。该包是宿主 API，不是第七个核心
数据对象。

```ts
export interface TopoPlugin {
  readonly apiVersion: 1;
  readonly id: string; // npm 风格稳定 id，例如 "acme.network"
  readonly nodeTypes?: readonly NodeTypeDefinition[];
  readonly layouts?: readonly LayoutPlugin[];
  readonly formats?: readonly FileFormatPlugin[];
}

export interface PluginRegistry {
  register(plugin: TopoPlugin): void;
  seal(): PluginCatalog;
}

export interface PluginCatalog {
  readonly plugins: readonly TopoPlugin[];
  readonly nodeTypes: ReadonlyMap<string, RegisteredNodeType>;
  readonly layouts: ReadonlyMap<string, RegisteredLayout>;
  readonly formats: ReadonlyMap<string, RegisteredFormat>;
}
```

注册必须原子完成。以下冲突直接抛出带插件 id 的错误，不采用“后注册覆盖前注册”：

- 重复插件 id；
- 重复节点 type；
- 重复布局 id；
- 重复格式 id；
- 两个 importer 声明同一扩展名。

内置能力先注册，第三方不能隐式替换。未来如需覆盖，必须另行设计显式 override
策略。`seal()` 后目录只读，保证多个 embed 实例、测试和 SSR 之间不串状态。

## 4. 节点类型 Schema

### 4.1 最小契约

```ts
import type { AttrValue, Node, TopoDoc, ValidationIssue } from "@talkincode/topox-core";

export interface AttrsSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, AttrPropertySchema>>;
  readonly required?: readonly string[];
  /** 默认为 true；未知 attrs 必须可保留，避免插件缺失时丢数据。 */
  readonly additionalProperties?: boolean;
  readonly order?: readonly string[];
}

export interface AttrPropertySchema {
  readonly type: "string" | "number" | "integer" | "boolean" | "json";
  readonly title?: string;
  readonly description?: string;
  readonly enum?: readonly AttrValue[];
  readonly default?: AttrValue;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly pattern?: string;
}

export interface NodeTypeDefinition {
  /** 必须与 Node.type 完全一致。 */
  readonly type: string;
  readonly displayName: string;
  readonly description?: string;
  readonly appearance?: {
    /** 本地、宿主可解析的 token；不是 HTML、React 组件或远程 URL。 */
    readonly icon?: string;
    readonly accent?: string;
  };
  readonly attrs?: AttrsSchema;
  readonly validate?: (context: {
    readonly node: Readonly<Node>;
    readonly doc: Readonly<TopoDoc>;
  }) => readonly ValidationIssue[];
}
```

v1 只承诺 Inspector 能稳定渲染字符串、数字、整数、布尔、枚举和 JSON 回退控件。
对象/数组不发明复杂表单协议，继续使用现有 JSON 编辑器。`default` 只在用户创建新
节点时使用；注册插件或打开旧文档时不得静默补写 attrs。

### 4.2 渲染与校验

节点显示按以下顺序解析：

1. `Node.icon`；
2. 已注册 Schema 的 `appearance.icon`；
3. 通用节点外观。

图标是数据 token，由宿主已安装的图标目录解析。v1 不允许 Schema 注入组件或
`dangerouslySetInnerHTML`，从而避免把节点类型注册变成任意 UI 执行面。

Inspector 保留现有核心字段、通用 attrs 编辑器和整体 JSON 编辑器。注册 Schema
只在 attrs 区域增加结构化字段。字段提交先构造候选 `Node`，通过
`makeNodeUpdate` 产生 diff，再由宿主应用；表单永远不直接修改文档。

`validateDoc` 保持纯结构校验。宿主另行组合：

```ts
validateDocWithPlugins(doc, catalog): ValidationIssue[]
```

其规则是：

- 未注册 `Node.type` 只产生 warning，不使开放类型失效；
- Schema 类型、required、范围、枚举和 pattern 产生带节点 ref 的诊断；
- 自定义 validator 只能返回诊断，不能返回修复后的文档；
- validator 抛错时产生插件错误诊断，当前导入或 Schema 表单提交失败，但编辑器
  本身继续运行；
- 整文档导入同时拒绝结构错误和已注册 Schema 的 error；
- 通用编辑入口至少展示插件诊断；是否扩大为所有 diff 的强制 preflight，应在节点
  Schema 实现 issue 中用既有非法文档的兼容样本决定，不能修改 core 的
  `applyDiff` 语义。

## 5. 布局插件

### 5.1 最小接口

```ts
import type { AttrValue, GraphDiff, TopoDoc } from "@talkincode/topox-core";

export interface LayoutPlugin {
  readonly id: string; // 例如 "topox.dagre"
  readonly displayName: string;
  readonly optionsSchema?: AttrsSchema;
  run(context: {
    /** 宿主提供的快照，不是可写文档句柄。 */
    readonly doc: Readonly<TopoDoc>;
    readonly viewId: string;
    readonly options: Readonly<Record<string, AttrValue>>;
    readonly signal: AbortSignal;
  }): GraphDiff | Promise<GraphDiff>;
}
```

返回 diff 而不是新文档，可复用现有预览、History 和 undo。宿主在应用前必须执行
布局专用 gate：

1. 只允许 `set_layout`；
2. `viewId` 必须是请求中的 View，`nodeId` 必须存在；
3. x/y 必须有限，width/height 如存在必须是有限正数；
4. 用 `applyDiff` 对捕获的基线文档试应用，验证 before 值和可逆性；
5. 异步运行期间若当前文档已不再是同一基线，丢弃陈旧结果；
6. 应用时由宿主统一写入 `origin: "plugin:layout:<id>"`。

dagre 退位为内置默认插件，不再是宿主特判：

```ts
export const dagreLayout: LayoutPlugin = {
  id: "topox.dagre",
  displayName: "Dagre",
  run: ({ doc, viewId, options }) =>
    autoLayoutDiff(doc as TopoDoc, viewId, options),
};
```

“默认布局器”是宿主配置，而不是插件自身的布尔标记，避免多个插件都宣称默认。
Studio 的 Arrange 菜单从目录列出布局器；embed 新增
`layout(id, options)`，现有 `autoLayout(options)` 可保留为调用默认布局器的兼容
别名。

## 6. 导入/导出插件

v1 文件格式只处理文本。二进制文件、流式解析和远程 URL 不在本设计内。

```ts
import type { AttrValue, TopoDoc } from "@talkincode/topox-core";

export interface FormatImportResult {
  readonly doc: TopoDoc;
  readonly warnings: readonly string[];
  readonly layout: "none" | "partial" | "complete";
}

export interface FileFormatPlugin {
  readonly id: string; // 例如 "topox.graphml"
  readonly displayName: string;
  readonly extensions: readonly string[]; // 小写且不带点
  readonly mimeType: string;
  readonly importer?: {
    parse(input: {
      readonly name: string;
      readonly text: string;
      readonly signal: AbortSignal;
    }): FormatImportResult | Promise<FormatImportResult>;
  };
  readonly exporter?: {
    readonly extension: string;
    serialize(input: {
      readonly doc: Readonly<TopoDoc>;
      readonly options: Readonly<Record<string, AttrValue>>;
      readonly signal: AbortSignal;
    }): string | Promise<string>;
  };
}
```

Studio 的单一 “Import…” 文件选择器接受所有 importer 扩展名，并按扩展名精确
分发。每个 exporter 生成一个 “Export {displayName}” 菜单项。当前
JSON/YAML/Mermaid/DOT/GraphML/CSV 逻辑分别包装为内置格式插件，不改变
`@talkincode/topox-interop` 的纯转换函数。

导入顺序固定为：

1. 解析到临时 `TopoDoc`；
2. 根据 `layout`，必要时调用宿主配置的默认布局插件；
3. 运行 `validateDoc` 和已注册节点 Schema 校验；
4. 全部通过后才创建新 History 并原子替换当前文档。

解析、布局或校验任一步失败，原文档和 History 均保持不变。exporter 只获得只读
快照；失败时不下载空文件，也不改变状态。

## 7. 分发与宿主加载

**npm 包是分发方式，显式注册是运行时接入方式，两者不是二选一。**

插件包导出普通 ESM 值或工厂，不通过 import side effect 修改全局对象：

```ts
// @acme/topox-network-plugin
export const acmeNetworkPlugin: TopoPlugin = { /* ... */ };
```

Studio 在一个组合根中静态导入部署方允许的插件：

```ts
const registry = createPluginRegistry();
registry.register(topoxBuiltinPlugin);
registry.register(acmeNetworkPlugin);
const catalog = registry.seal();

root.render(<App plugins={catalog} />);
```

embed 由每个挂载实例显式接收：

```ts
mountTopoView(element, {
  doc,
  plugins: [acmeNetworkPlugin],
});
```

ESM 宿主可以直接安装 npm 包。standalone IIFE 宿主必须在构建时把插件一起打包，
或传入已经加载的插件对象；TopoX 不接受插件 URL，也不替宿主插入远程 script。
v1 不支持 mount 后注册或卸载。

## 8. 错误隔离与诚实的安全边界

宿主通过统一调用边界执行每个插件能力，并在错误中保留
`pluginId/capability/cause`：

| 失败位置 | 宿主行为 |
| --- | --- |
| 注册冲突/API 版本不支持 | 原子拒绝该插件，启动时明确报错 |
| 节点 validator 抛错 | 产生 error 诊断，拒绝当前插件驱动的提交/导入 |
| 布局抛错、reject 或返回非法 diff | 不应用任何 op，保留文档并显示错误 |
| importer 抛错或返回非法文档 | 保留原文档和 History |
| exporter 抛错 | 不触发下载 |
| 未来自定义 UI 抛错 | 必须有独立 Error Boundary；不属于 v1 Schema 插件 |

插件调用接收宿主创建的文档快照；规范、类型和开发模式冻结共同防止意外写入。
但进程内 `try/catch` 只能隔离 throw/rejection，不能阻止恶意代码、死循环、内存
耗尽或同步阻塞。`AbortSignal` 只提供协作式取消。达到不可信隔离必须使用
Worker/iframe/独立进程并建立权限模型，明确留给另一份安全设计，不能在 v1 中
声称“已沙箱化”。

## 9. 端到端伪代码：注册自定义设备类型

```ts
import type { TopoPlugin } from "@talkincode/topox-plugin-api";

export const acmeDevicePlugin: TopoPlugin = {
  apiVersion: 1,
  id: "acme.devices",
  nodeTypes: [
    {
      type: "acme-ap",
      displayName: "Acme Access Point",
      appearance: { icon: "acme-access-point", accent: "#0f766e" },
      attrs: {
        type: "object",
        properties: {
          model: {
            type: "string",
            title: "Model",
            enum: ["AP-100", "AP-200"],
          },
          radioCount: {
            type: "integer",
            title: "Radio count",
            minimum: 1,
            maximum: 8,
          },
          managed: { type: "boolean", title: "Managed" },
        },
        required: ["model"],
        order: ["model", "radioCount", "managed"],
        additionalProperties: true,
      },
      validate: ({ node }) =>
        node.ref?.startsWith("device:") === true
          ? []
          : [{
              severity: "error",
              code: "acme_ref",
              message: `${node.id}: ref must start with device:`,
              ref: node.id,
            }],
    },
  ],
};
```

注册后，一个 `{ type: "acme-ap" }` 节点仍是普通 core `Node`：

1. Canvas 从目录解析本地图标 token 与 accent；
2. Inspector 依据 attrs Schema 生成字段；
3. 用户修改 `radioCount` 时，Inspector 先校验候选节点，再通过
   `makeNodeUpdate` 产生可撤销 diff；
4. 未安装该插件的另一个宿主仍能读取、通用渲染和 JSON 编辑该节点，不丢 attrs；
5. 插件代码或校验失败只拒绝当前操作，不改变 `TopoDoc`。

## 10. 与现有代码的落点映射

| 现有落点 | 后续变化 |
| --- | --- |
| `packages/core/src/types.ts` | 不变；`Node.type/attrs/icon` 已足够表达 |
| `packages/core/src/validate.ts` | 不加入领域规则；由 plugin-api 组合额外诊断 |
| `packages/editor/src/TopoCanvas.tsx` `typePalette` | 改为接收节点类型目录，保留通用 fallback |
| `apps/studio/src/Inspector.tsx` `AttrsEditor` | 增加 Schema 字段层，提交仍走 `makeNodeUpdate` |
| `packages/editor/src/layout.ts` `autoLayoutDiff` | 包装为 `topox.dagre` 内置布局插件 |
| `apps/studio/src/App.tsx` Arrange/导入导出 | 从封存目录构造菜单并通过统一调用边界执行 |
| `packages/interop/src/index.ts` | 保留纯转换 API；另导出或集中提供内置格式适配器 |
| `packages/embed/src/mount.ts` | options 接收插件列表；布局句柄按 id 调用目录 |
| `apps/studio/src/` 组合根 | 新增部署级插件清单，App 本身不自动发现 npm 包 |

## 11. 评审通过后的实现拆分

本草案通过评审后再创建独立 issues，避免一次改动跨越所有宿主：

1. 节点 Schema 目录、组合校验、Canvas 外观与 Inspector 表单；
2. 布局插件契约、dagre 适配、结果 gate 与异步陈旧结果处理；
3. 格式插件契约、内置格式适配与 Studio 动态菜单；
4. Studio/embed 的组合根、API 兼容与插件错误观测。

每个实现 issue 都必须分别补公开边界单测、Studio 或 embed Happy Path E2E，以及
适用的失败后状态保持用例。
