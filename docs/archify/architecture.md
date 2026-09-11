# Vibe Flow360 项目架构

交互式架构图： [architecture.html](./architecture.html)。图中的组件、连接和源码定位由 `architecture.json` 定义；规格基于仓库 revision `2ebb37a5d3ddc1050c8299a6c7f7d0ee4c293a91` 生成。

## 架构结论

Vibe Flow360 是一个以本机为中心的单机工作区：React + Vite 提供工程师交互和 3D 资源查看，Go 服务通过 Gin 暴露 `/api` 并嵌入构建后的 Web 资源；同一个 Go 进程组合 Agent、Flow360 领域服务和 `.vibesim` 本地 stores。Flow360 CLI 是本地到 Flow360 Cloud 的适配边界，远端平台仍然是项目、Draft、网格和 Case 的权威来源。

```text
工程师
  ↓ 浏览器
React Web Workspace ── HTTP / SSE ──> Go HTTP Server
                                      ├── Agent 服务与干预引擎 ──> AI Provider / Codex
                                      │                         └── Knowledge Base
                                      ├── Flow360 领域服务 ──> .vibesim 本地数据
                                      │                    └── Flow360 CLI Adapter ──> Flow360 Cloud
                                      └── 资源、计划、结果与恢复 API
```

## 主要组件

| 组件 | 职责 | 代码证据 |
| --- | --- | --- |
| React Web Workspace | 路由、Project/Resource/Case 工作区、3D Viewer 和本地化 UI | [`web/src/App.tsx`](../../web/src/App.tsx)、[`web/package.json`](../../web/package.json) |
| Go HTTP Server | 创建 Gin 路由、嵌入 Web、组合所有领域服务和存储依赖 | [`internal/server/server.go`](../../internal/server/server.go) |
| Agent 服务与干预引擎 | 管理模型 provider、聊天上下文、preflight/运行失败干预、修复建议和恢复流程 | [`internal/agent/service.go`](../../internal/agent/service.go)、[`internal/agent/engine.go`](../../internal/agent/engine.go) |
| Flow360 领域服务 | Project 同步、资源详情、Draft 参数、计划、导入、比较、结果和后台任务 | [`internal/server/server.go`](../../internal/server/server.go) 的 `/api` 路由与服务依赖 |
| `.vibesim` 本地数据 | 保存计划、导入、Project mirror、Flow360 cache、聊天、干预、比较工作区、预览和任务状态 | [`internal/server/server.go`](../../internal/server/server.go) 的 `dataDir` stores |
| Knowledge Base | 默认本地索引，也可切换 HelixDB；向量存储和 embedding provider 通过接口替换 | [`internal/knowledge/service.go`](../../internal/knowledge/service.go) |
| Flow360 CLI Adapter | 解析本地/托管运行时、配置 profile 和环境、执行 Flow360 命令并读取项目/资源/运行状态 | [`internal/flow360/client.go`](../../internal/flow360/client.go) |
| Flow360 Cloud | 承载权威项目、Draft、网格、Case 和远端 CFD 计算 | [`README.md`](../../README.md) 的“Local workspace, cloud computation”说明 |

## 关键运行链路

1. 工程师在浏览器中进入 Web workspace；前端路由覆盖 Project、资源工作区、比较工作区、STEP Library、AI Create 和教程。
2. 前端通过本机 Go 服务的 `/api` 访问 Project、资源、计划、导入、Agent 和结果能力；开发模式下 Vite 将 `/api` 代理到 `localhost:9292`，生产构建后的 Web 资源由 Go 二进制嵌入。
3. Go 服务将自然语言上下文、资源信息、计划和 preflight 结果交给 Agent 服务；Agent 可调用配置的内置模型、Codex 或 Codex App Server，并把干预、会话和计划状态写入本地。
4. Flow360 领域服务先从 Cloud 同步元数据和按需资源资产，再执行本地 schema/preflight、参数差异审查、批准和恢复逻辑。
5. 只有在用户审查并批准不可变计划后，领域服务才通过 Flow360 CLI Adapter 提交远端运行；状态、日志、收敛和结果再经本地 API 返回给 Web workspace。

## 数据与信任边界

- `.vibesim` 是可再生缓存和工作流状态的本地根目录；Project mirror、可视化资产、计划、聊天和恢复信息不会替代 Cloud 的权威数据。
- Flow360 API key 保留在本地服务进程；Web 应用只通过本地 API 访问能力，不直接持有凭据。
- AI 输出是建议和诊断，不是批准。涉及计费、远程提交或不可逆操作必须经过用户确认。
- Knowledge Base 默认可用本地索引；HelixDB 和 OpenAI embedding 是可配置扩展，不是所有部署都必需的远端依赖。

## 维护提示

架构图描述的是当前代码验证出的运行边界，不把 `internal/` 目录中的每个 Go 包都当作独立进程。新增 API、持久化 store、外部 provider 或部署边界时，应同步更新 `docs/archify/architecture.json` 的源码证据和本页的职责说明。
