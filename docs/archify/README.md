# Archify 架构文档

这组文档按“总览 → 模块 → 运行时交互 → 数据 → 状态”展开。先看总览，再按排查问题打开对应细图；每个 HTML 都支持搜索、聚焦视图、主题切换和 SVG 导出。

| 关注点 | 交互文档 | 源规格 |
| --- | --- | --- |
| 项目整体边界与依赖 | [architecture.html](architecture.html) | [architecture.json](architecture.json) |
| 后端模块职责与调用关系 | [backend-modules.architecture.html](backend-modules.architecture.html) | [backend-modules.architecture.json](backend-modules.architecture.json) |
| Agent 计划、审批与失败恢复 | [agent-recovery.workflow.html](agent-recovery.workflow.html) | [agent-recovery.workflow.json](agent-recovery.workflow.json) |
| Project 浏览、Mirror 与 CLI 往返 | [request-sequence.sequence.html](request-sequence.sequence.html) | [request-sequence.sequence.json](request-sequence.sequence.json) |
| Cloud → CLI → Domain → 本地消费 | [local-data.dataflow.html](local-data.dataflow.html) | [local-data.dataflow.json](local-data.dataflow.json) |
| Simulation Plan 状态、等待与恢复 | [plan-lifecycle.lifecycle.html](plan-lifecycle.lifecycle.html) | [plan-lifecycle.lifecycle.json](plan-lifecycle.lifecycle.json) |

## 阅读指引

- 想知道“代码在哪、谁依赖谁”：看后端模块图，并打开节点的来源引用。
- 想知道“请求怎么走、缓存何时刷新”：看请求时序图的 `Mirror 与缓存` 视图。
- 想知道“为什么不能直接运行”：看 Agent 工作流和 Plan 生命周期中的 preflight、审批、恢复分支。
- 想知道“数据落在哪里、谁消费”：看本地数据流图的资源路径和计划路径视图。

所有规格均使用 Archify `showcase` 质量配置生成，并在交付前通过 9 项布局与构图检查。
