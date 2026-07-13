# TopoX 项目画像与方向

> 本文档是北极星和护栏：讲清楚"这个项目应该成为什么样、绝不能变成什么样"。
> 具体怎么做、按什么顺序做，由执行者自行决定。唯一的强制章节是文末的验收矩阵。

## 项目概述

TopoX 是一个用于**描述、编辑、运行和监控拓扑系统**的引擎。它服务于这样的场景：网络/基础设施服务商的每个产品交付都对应一套拓扑——对外交付一份清单，对内业务、资源、运维部门需要同一份数据的直观结构视图，并且整个流程要适合 AI 辅助。

它不是画图软件。拓扑是真实数据（纯关系：节点、边、组、属性），编辑器只是数据之上的一个视图。一切修改——用户拖拽、AI 提案、文件导入——都以**可逆的 GraphDiff** 进入系统，因此撤销、审计、回放是结构性收益而非附加功能。运行态（状态、指标、流量）是叠加在文档之上的独立层，永不写入文档。

- 架构图

```text
                 ┌──────────────────────────────────────────────┐
                 │                 apps/studio                  │
                 │  Canvas · Inventory · JSON · Inspector       │
                 │  AI 面板 · Timeline DVR · 导入导出 · 模拟器   │
                 └────────┬──────────────┬─────────────┬────────┘
                          │              │             │
                ┌─────────▼────┐  ┌──────▼─────┐ ┌─────▼────────┐
                │ @topox/editor│  │ @topox/dsl │ │@topox/interop│
                │ React Flow   │  │ DSL → Diff │ │ YAML·Mermaid │
                │ doc 进 diff 出│  │ 编译器      │ │ 双向互转      │
                └─────────┬────┘  └──────┬─────┘ └─────┬────────┘
                          └──────────────┼─────────────┘
                                  ┌──────▼───────┐
                                  │ @topox/core  │  零运行时依赖
                                  │ Graph · Diff · History │
                                  │ Runtime · Timeline · Grouping │
                                  └──────────────┘

编辑数据流（宪法）：Prompt → DSL → GraphDiff → Preview → 用户确认 → Apply
运行态数据流：外部系统(NMS · ACS · 监控 · …) → RuntimeEvent（按 Node.ref 寻址）
              → 叠加渲染 + Timeline 记录，永不进入文档与历史
```

## 项目画像（目标状态）

做好之后，TopoX 是这样的：

- **一份数据，多个视图。** 同一个 `TopoDoc` 能同时支撑：对外的交付清单（Inventory/CSV）、对内的结构画布（Canvas）、机器可读的交换格式（JSON/YAML/Mermaid）。任何一个视图的变化都不需要"重新画一遍"。
- **AI 是一等公民，但永远隔着一层 Diff。** 自然语言可以生成、修改拓扑，但 AI 的输出统一是 DSL → GraphDiff，经过预览和用户确认才落地。用户对 AI 提案的信任来自"可预览、可拒绝、可撤销"，而不是来自模型本身。
- **运行态让拓扑活起来。** 接入真实系统后，节点有状态灯、指标行，边有流量动画；出问题时能沿时间轴回放到故障发生的那一刻。Runtime 是纯叠加层：断开数据源，文档完好如初。
- **内核十年稳定。** 内核只认识节点、边、属性、状态；`net-router` 对内核是不透明字符串。新协议、新 AI 框架、新领域出现时，通过 type/attrs/schema/插件扩展，内核不重构。
- **所有状态可序列化、可回放。** 文档、diff 历史、运行事件都是 JSON 安全的值；`undefined` 不过线，patch 里 `null` 表示删字段。

品质优先级（冲突时的裁决顺序）：

1. **数据正确性 > 一切。** 宁可拒绝一次编辑，也不让文档进入非法状态；diff 应用失败必须无部分残留。
2. **模型简洁 > 功能数量。** 核心对象只有 Graph/Node/Edge/Group/View/RuntimeState；新需求先问"能否用 attrs/type/扩展表达"，再考虑动模型。
3. **编辑手感 > 渲染华丽。** 拖拽必须流畅（交互帧不碰文档），视觉效果让位于操作延迟。
4. **可控的 AI > 聪明的 AI。** 提案-确认流程的确定性优先于生成质量。

## 当前能力清单

以下能力均已实现并有代码/测试支撑（48 个测试全绿，`npm test`）：

- **内核数据模型与可逆 Diff 引擎**

  Graph/Node/Edge/Group/View/TopoDoc 类型与不变式；`applyDiff`/`invertDiff`；失败即抛 `DiffConflictError` 且无部分状态泄漏。证据：`packages/core/src/{types,diff}.ts`，`packages/core/tests/core.test.ts`（applyDiff / invertDiff / makeNodeUpdate）。

- **历史与撤销重做**

  `History` 基于可逆 diff 实现 undo/redo 与操作记录。证据：`packages/core/src/history.ts`，core.test.ts（History）。

- **文档校验**

  重复 id、悬空边、组嵌套循环、多父成员等结构性错误检测。证据：`packages/core/src/validate.ts`，core.test.ts（validate）。

- **运行态叠加与时间回放**

  `RuntimeState` + `applyRuntimeEvent`（按 `Node.ref` 寻址优先）；`RuntimeTimeline` 支持 DVR 式回放（二分定位 + checkpoint 重放 + 事件折叠）。证据：`packages/core/src/{runtime,timeline}.ts`，core.test.ts（runtime overlay / runtime timeline）。

- **节点 Trace 下钻**

  选中节点可查看保留窗口中的状态变迁与指标样本，点击任一事件会将 Timeline 跳转到对应时刻。Trace 只从有界 `RuntimeTimeline` 事件流派生，不写入文档、diff 或编辑历史。证据：`packages/core/src/timeline.ts`（`nodeHistory`）；`apps/studio/src/Inspector.tsx`；`apps/studio/e2e/runtime.spec.ts`。

- **运行态快照**

  累积的 RuntimeEvent 窗口可保存为版本化 JSON 并在刷新后重新加载回放；加载前完整校验格式、版本、事件与时间范围，坏文件不改变当前运行态。快照与 TopoDoc 严格分离。证据：`packages/core/src/runtime-snapshot.ts`；`docs/runtime-snapshots.md`；`apps/studio/e2e/snapshot.spec.ts`。

- **React Flow 编辑器（受控视图）**

  doc 进、diff 出；拖拽走本地状态松手一次提交；dagre 自动布局以 diff 形式产出；组可视化（展开=派生包围盒容器、折叠=代理节点、跨边界边重定向合并、嵌套父盖子）。证据：`packages/editor/src/{TopoCanvas,convert,layout}.tsx|ts`，`packages/editor/tests/editor.test.ts`（group projection 等）。

- **DSL 编译器（AI 输出格式）**

  行导向 DSL 逐行容错编译为 GraphDiff；`docToDsl` 反向序列化；附 LLM 提示指南。证据：`packages/dsl/src/`，`packages/dsl/tests/dsl.test.ts`。

- **YAML / Mermaid 互转**

  YAML 全保真往返；Mermaid flowchart 导出（嵌套 subgraph）与容错子集导入。证据：`packages/interop/src/{yaml,mermaid}.ts`，`packages/interop/tests/interop.test.ts`。

- **Studio 演示应用**

  Canvas / Inventory / JSON 三视图；Inspector（节点/边/组的基础属性、自定义 attrs、JSON 整体编辑，草稿式提交）；AI 面板（Prompt → DSL → Diff → Preview → Apply，OpenAI 兼容端点）；模拟器 + Timeline DVR 条；JSON/YAML/Mermaid 导入导出 + CSV 清单导出；搜索过滤。证据：`apps/studio/src/`。**注意：studio 目前无自动化测试**（见验收矩阵）。

- **共享 Studio 文档源协议**

  `?src=<url>&save=<url>&ret=<url>`：studio 从宿主后端 GET 加载文档、PUT 保存回去（同域自带 cookie）、可跳回业务系统；未保存改动有 `Save*` 标记与离开页警告。业务前端用只读 embed 展示，编辑跳转共享 studio，一份部署服务所有系统。证据：`apps/studio/src/docsource.ts`，接线在 `App.tsx`，指南 `docs/embedding.md`；Go 参考后端 `examples/studio-go-host/`（标准库实现：静态托管 + 文档存储 + SSE 演示流，已手工验证同域 load→edit→save 落盘闭环）。

- **搜索**

  按名称/标签/类型/属性过滤节点；画布高亮匹配、弱化非匹配，Enter/Shift+Enter 或按钮可在结果间跳转并自动聚焦视口。搜索只影响视图，不产生 diff。证据：`packages/core/src/inventory.ts`（`searchNodes`）；`packages/editor/src/{convert,TopoCanvas}.ts|tsx`；`apps/studio/e2e/capabilities.spec.ts`。

- **SSE 运行态接入客户端**

  `connectRuntimeSSE(url)`：订阅 SSE 流（每条 `data:` 行一个 RuntimeEvent JSON），折叠为 RuntimeState；断线重连交给平台 EventSource，传输可注入以便测试。证据：`packages/core/src/sse.ts`，`packages/core/tests/sse.test.ts`。

- **框架无关嵌入包（@topox/embed）**

  `mountTopoView(el, options)` 把画布挂进任意 DOM 元素，宿主无需 React：React/React Flow/CSS 打进产物（ESM + IIFE standalone 双产物）。句柄提供 getDoc/applyDiff/undo/redo/autoLayout/setReadOnly/pushRuntimeEvent/connectSSE/destroy。证据：`packages/embed/src/`，纯 HTML 宿主示例 `examples/embed-plain/`（含演示 SSE 服务器），指南 `docs/embedding.md`。

## 非目标（铁律）

除非用户明确修改边界，以下规则不可越过，也不得转写为"以后会做"：

- **不做 Office、PPT、Visio、XMind、白板、甘特图、UML 全家桶、BPMN 全家桶、数据库设计器、CAD。** TopoX 只关心"关系"，不关心通用绘图与文档排版。
- **内核不引入任何业务概念。** 内核代码中不得出现 Kubernetes、RouterOS、Redis、MCP 等领域词汇的语义分支；领域差异只能通过 type 字符串、attrs、schema 与插件表达。
- **Graph 不存几何。** 坐标、尺寸、视口只属于 View；任何把 x/y 写进 Node 的改动都是违宪。
- **Runtime 不进文档。** 运行态状态、指标、事件不得写入 TopoDoc、不得进入 diff 历史、不得被序列化进文档导出。
- **AI 不直接操作画布或文档。** 所有 AI 修改必须走 DSL → GraphDiff → Preview → 确认 → Apply；不存在"AI 直接 setState"的通道。
- **绕过 Diff 的修改通道不允许存在。** 任何入口（UI、导入、AI、未来的协作）都必须以 GraphDiff 落地（整文档替换式导入除外，且导入必须先过校验）。
- **内核保持零运行时依赖。** `@topox/core` 不引入任何 npm 运行时依赖；序列化格式保持纯 JSON。

## 方向与意图

以下描述想去的地方和原因，不规定顺序与实现方式：

- **真实运行态接入（完成 Phase 2）**

  事件接入契约已定义并有客户端实现：SSE 流上每条消息是一个 RuntimeEvent（snapshot/node/edge），按 `Node.ref` 匹配（见 `docs/embedding.md` 协议节）。剩余目标：让真实生产系统按此契约推送状态与指标，并在真实负载下校准；契约必须保持"Runtime 不进文档"的铁律。WebSocket 可作为第二传输，复用同一事件模型。

- **Trace 与 Snapshot**

  点击节点可下钻日志、事件、指标历史；运行态可保存/加载快照。服务于运维部门的故障定位场景，是 Timeline 回放的自然延伸。

- **真实数据端到端验证**

  用真实生产环境的拓扑数据（清单规模、命名习惯、ref 语义）走一遍导入→编辑→导出→运行态全流程，以此校准模型边界与性能，而不是靠 demo 数据自证。

- **Phase 3：Agent、协作与插件**

  Agent 自动生成拓扑、修复布局、优化结构、发现异常——全部以 diff 提案形式进入既有确认管线；多人协作（实时编辑、冲突合并、评论、锁）建立在"一切皆 diff"之上；插件体系（节点/布局/导入导出/主题/Inspector/AI 插件）是内核"只认关系"承诺的兑现方式。

- **更多交换格式**

  GraphML、DOT 等格式的导入导出，服务于与既有网络工具生态的互通。

- **编辑器纵深**

  搜索结果画布高亮与定位跳转、对齐/吸附、节点复制、锁定等编辑手感增强。服务于"编辑手感 > 渲染华丽"的品质排序。

## 完成的样子

> 当以下可观察结果出现时，对应的方向才算真正达成：

- **锚定场景可以退役专有画图工具。** 真实的网络交付拓扑完全用 TopoX 描述、编辑并产出交付清单，且没有为迁移在内核里加过任何业务特判。
- **一次真实故障可以被回放。** 接入真实数据源后，运维可以把时间轴拖回故障时刻，看到当时的节点状态与边流量。
- **AI 提案零信任落地。** 任何 AI 生成的修改在落地前都能被预览为 diff、被拒绝、落地后能被一键撤销；不存在例外通道。
- **核心数据流有自动化测试守护。** 内核 diff/回放/校验的回归能在 CI 中被挡下（已落地：`.github/workflows/ci.yml` 在 push/PR 上运行全部 vitest 单测与 studio Playwright E2E）。
- **文档-代码一致。** README 与本画像描述的能力均可在代码中找到对应实现；冲突时以代码和可运行测试为准，并回改文档。

## 验收矩阵（业务能力覆盖矩阵）

> 覆盖底线（硬性规定，不得降级为建议）：
>
> 1. 每个一级功能至少有一条 Happy Path E2E。
> 2. 每个高风险功能至少覆盖一条失败路径。
> 3. 每个涉及权限的功能至少验证两种角色。
> 4. 每个会修改系统状态的操作至少验证一次失败后的恢复或回滚。
> 5. 每次新增一级业务功能，必须同步新增对应的 E2E 并更新本矩阵。
>
> 说明：TopoX 目前是单用户本地工具，无权限模型，"权限角色覆盖"列统一为不适用；引入协作后该列必须重新评估。"E2E"在当前形态下指贯穿 studio UI 或至少贯穿"包边界组合"的端到端验证；仅有内核单元测试不算 E2E。

| 一级功能 | 风险级别 | Happy Path E2E | 失败路径 | 权限角色覆盖 | 失败恢复/回滚 | 证据（测试路径/用例） |
| --- | --- | --- | --- | --- | --- | --- |
| 图编辑（节点/边增删改、移动、连线） | 中 | ✅ Inspector 改 label→画布更新 | ✅ diff 冲突拒绝 | 不适用 | ✅ UI 级 undo 还原已验证 | `apps/studio/e2e/edit.spec.ts`；内核层 `packages/core/tests/core.test.ts` applyDiff/invertDiff/History |
| 撤销/重做 | 中 | ✅ 编辑后 ↩ 还原（UI 级） | ✅ 空栈边界 | 不适用 | ✅ 本身即回滚机制 | `apps/studio/e2e/edit.spec.ts`；`packages/core/tests/core.test.ts` History |
| 分组（创建/解组/折叠/展开/嵌套） | 中 | ✅ UI 级创建→折叠→展开→解组 | ✅ 组循环/多父校验 | 不适用 | ✅ UI 级 undo 恢复解组 | `apps/studio/e2e/capabilities.spec.ts`；`packages/editor/tests/editor.test.ts` group projection；`packages/core/tests/core.test.ts` validate |
| AI/DSL 管线（Prompt→DSL→Diff→Preview→Apply） | 高（外部 API 副作用 + 批量改文档） | ✅ DSL→Preview→Apply→undo 贯穿 studio | ✅ 坏行报行级错误且文档不变（UI 级）+ 编译容错单测 | 不适用 | ✅ Apply 后 UI 级 undo 已验证 | `apps/studio/e2e/dsl.spec.ts`；`packages/dsl/tests/dsl.test.ts` compileDsl/tokenize |
| 导入（JSON/YAML/Mermaid，整文档替换） | 高（可整体覆盖用户文档） | ✅ File▾ 导入 JSON 整文档替换 | ✅ 坏 JSON 与校验失败文档均被拒（UI 级） | 不适用 | ✅ 拒绝后原文档完好（UI 级） | `apps/studio/e2e/import.spec.ts`；`packages/interop/tests/interop.test.ts` yaml/mermaid import |
| 导出（JSON/YAML/Mermaid/CSV） | 低（只读投影） | ✅ File▾ 四种下载均可解析 | 不适用（只读，无状态变更） | 不适用 | 不适用（只读） | `apps/studio/e2e/export.spec.ts`；`packages/interop/tests/interop.test.ts` yaml/mermaid export；core.test.ts inventory projection |
| 运行态叠加（状态/指标/活跃边） | 中 | ✅ Simulate 状态/指标叠加贯穿 UI | ✅ 未知 ref 事件安全忽略 | 不适用 | ✅ UI 级关闭模拟后叠加清除、文档与 History 不变 | `apps/studio/e2e/runtime.spec.ts`；`packages/core/tests/core.test.ts` runtime overlay；`packages/editor/tests/editor.test.ts` runtime overlay projection |
| Timeline 回放 | 低 | ✅ UI 级历史状态定位 + 暂停/恢复/Live | ✅ 时间戳单调性 clamp | 不适用 | 不适用（只读回放，不改文档） | `apps/studio/e2e/runtime.spec.ts`；`packages/core/tests/core.test.ts` runtime timeline |
| 节点 Trace（事件/指标历史） | 低 | ✅ UI 级选中节点→查看状态/指标历史→跳转 Timeline | 不适用（只读运行态） | 不适用 | 不适用（只读，不改文档） | `apps/studio/e2e/runtime.spec.ts`；`packages/core/tests/core.test.ts` runtime timeline history |
| 运行态快照（保存/加载） | 中 | ✅ Simulate→保存→刷新→加载→回放/逐帧 | ✅ 未知版本拒绝且当前回放、文档、History 不变 | 不适用 | ✅ 加载先校验后原子替换 | `apps/studio/e2e/snapshot.spec.ts`；`packages/core/tests/core.test.ts` runtime snapshots |
| Inspector 属性编辑（基础/attrs/JSON） | 中 | ✅ label 编辑贯穿 UI（attrs/JSON 编辑待补） | 待核验（JSON 编辑的 id 不变/端点校验在 `apps/studio/src/Inspector.tsx`，无测试） | 不适用 | ✅ 编辑走 update diff，UI 级 undo 已验证 | `apps/studio/e2e/edit.spec.ts`；内核层 `core.test.ts` makeNodeUpdate |
| 搜索（名称/标签/类型/属性） | 低 | ✅ UI 级高亮/弱化 + 前后结果定位 + Inventory 过滤 | 不适用（只读过滤） | 不适用 | 不适用（只读，History 保持不变） | `apps/studio/e2e/capabilities.spec.ts`；`packages/editor/tests/editor.test.ts` search projection；`packages/core/tests/core.test.ts` searchNodes 断言 |
| 自动布局（dagre） | 中 | ✅ UI 级坐标变化 | 待核验 | 不适用 | ✅ UI 级 undo 恢复原坐标 | `apps/studio/e2e/capabilities.spec.ts`；`packages/editor/tests/editor.test.ts` autoLayoutDiff（含幂等性） |
| SSE 运行态接入（connectRuntimeSSE） | 中 | ✅ 单测覆盖 snapshot→patch 折叠（浏览器级 E2E 缺口） | ✅ 畸形消息 onError 后继续流 | 不适用 | ✅ 叠加层可整体清除；close 幂等 | `packages/core/tests/sse.test.ts` |
| 嵌入挂载（mountTopoView） | 中 | ✅ 纯 HTML 宿主挂载 + pushRuntimeEvent + destroy | 待核验 | 不适用 | ✅ destroy 清空挂载点；编辑走同一 diff/undo 管线 | `apps/studio/e2e/embed.spec.ts`；`examples/embed-plain/` |
| 共享 Studio 文档源（src/save/ret） | 高（PUT 覆盖宿主文档） | ✅ ?src 加载→编辑→PUT→Saved 闭环（PUT body 契约断言） | ✅ 加载 404 回退 demo 并报错（UI 级）；PUT 500 报错可重试 | 待核验（依赖宿主端点鉴权，同域 cookie 透传） | ✅ PUT 失败本地编辑完好、重试后成功（UI 级）；未保存改动有离开警告 | `apps/studio/e2e/sharedstudio.spec.ts` |

覆盖现状：

- 三条改状态主链路（图编辑、AI 管线 Apply、导入）、共享 Studio 保存闭环，以及运行态叠加/Timeline/Trace/快照、分组、布局、搜索、导出、embed 挂载均已有贯穿公开边界的 Playwright E2E（`apps/studio/e2e/`，CI 强制运行）。
- 各"待核验"项在补测试或人工确认后更新本矩阵。

## 维护规则

- 代码与本文档冲突时，以代码和可运行测试为准，冲突处标注"需修订"。
- 新需求先对照"非目标"检查；违反则先与用户确认是否修改铁律。
- 新增/下线一级功能时同步增删矩阵行；日常任务进度不写入本文档。
