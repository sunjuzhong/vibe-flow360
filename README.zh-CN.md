# Vibe Flow360

[English](README.md) | [简体中文](README.zh-CN.md)

**描述物理问题，审查仿真计划，然后放心运行。**

Vibe Flow360 是一个面向 [Flow360](https://www.flexcompute.com/flow360/) 的本地化
AI 工程工作台。它通过 Flow360 CLI 连接已有账号，把云端 Project 带入响应迅速的
Web 工作区，帮助用户规划、审查、运行和理解 CFD 仿真，而不必把每个工程问题都变成
一个需要维护的 Python 项目。

```text
你：比较这两个 Case，解释为什么阻力增大了。

Vibe Flow360：
  我读取了两者的参数、收敛历史和现有结果。
  候选 Case 同时改变了攻角和网格加密设置。
  我可以分别列出这些变化，但当前对比还不能隔离出唯一原因。
```

## 为什么选择 Vibe Flow360

Flow360 已经提供 Python API 和云端 Web 界面。Vibe Flow360 提供的是另一种工作方式：

- **本地运行。** Go 服务和 React 工作区运行在用户自己的电脑上。Project 元数据和已
  打开的可视化资源会同步到本地，并从 Flow360 Cloud 更新。
- **建立在 Flow360 之上。** 登录、验证、Draft 和远程执行继续使用已安装的
  `flow360` CLI 与现有云端账号。
- **便于团队定制。** 团队可以在本地服务和 Web 工作区中扩展自己的审查规则、工作流、
  可视化和内部集成。
- **有工程边界的 AI。** AI 可以澄清需求、准备计划、建议参数修改、诊断失败并解释结果，
  但不能替用户批准或提交付费计算。

Vibe Flow360 不是新的求解器，也不是第二套云平台。远程计算仍由 Flow360 完成；
Vibe Flow360 在它之上提供可定制的本地工程工作层。

## 当前可以完成什么

- 浏览 Flow360 Folder、Project，以及 Geometry、SurfaceMesh、VolumeMesh 和 Case 资源。
- 导入 CAD、管理带版本的 STEP Library，或通过 AI Create 生成当前支持的解析 STEP 几何。
- 在专用 3D 工作区中检查资源，并在本地保存轻量 Project 元数据和已打开的可视化资源。
- 在 Project、Resource 或 Draft 上下文中使用 Ask AI，让对话始终对应正在审查的工程对象。
- 通过 Schema 表单或 JSON 编辑 Draft 参数，本地验证，并在执行前查看语义差异。
- 批准不可变计划，通过 Flow360 CLI 提交，监控状态，并恢复中断或失败的工作流。
- 查看 Case 结果、收敛信息和结果表格；保存 Case 对比工作区并请求 AI 解读。
- 在浏览器中学习六个可在本地检查的引导式 CFD 教程。

## 在本地试用

要求：Go 1.24+、Node.js 22+，以及 Flow360 账号。

```bash
make build
./vibe-flow360 init
./vibe-flow360 serve
```

打开 [http://localhost:9292](http://localhost:9292)。`init` 会准备隔离的 Python 3.11
运行环境，安装固定版本的 Flow360 和 CadQuery 依赖，创建或更新 `.env`，并验证登录。
该命令可以安全地重复运行。

源码开发时，可以分别启动后端和 Vite 前端：

```bash
go run -buildvcs=false ./cmd/server serve
cd web
npm install
npm run dev
```

前端会把 `/api` 代理到本地的 `http://localhost:9292` 服务。

## 学习工作流

可以先阅读[产品概览](docs/zh-CN/overview/why-vibe-flow360.md)，再完成
[第一次仿真工作流](docs/zh-CN/getting-started/first-simulation.md)，也可以启动应用后直接
打开 `/tutorials`。

当前教程包括：

1. 可信的升力与阻力结果
2. Mach 与 Reynolds 相似性
3. 曲率敏感的圆柱网格
4. 多段翼型边缘加密
5. 顺流向尾流加密
6. 外部远场选择

所有教程都可以在不提交云端任务的情况下学习。创建或运行 Flow360 资源仍需要明确确认
或批准。

## 本地工作台，云端计算

```text
浏览器
  ↓
用户电脑上的 Vibe Flow360
  ├── Web 工作区和 AI 会话
  ├── Project 镜像与可视化缓存
  ├── 参数验证与审批状态
  └── Flow360 CLI 适配层
          ↓
      Flow360 Cloud
```

Project 初次同步只读取元数据。Geometry 可视化数据会在打开时下载并在本地复用；大型
CAD、网格、体数据和 Case 结果压缩包不会在初次同步时复制。实时刷新、远程执行和结果
下载仍然依赖 Flow360 Cloud 与可用网络。

## 安全边界

AI 输出是建议，不是批准。只有当计划通过 Flow360 Schema preflight、用户检查准确的
参数变化、批准不可变计划并再次确认提交后，远程执行才会开放。凭据保留在本地服务进程
中，不会返回给 Web 应用。

Vibe Flow360 目前仍是持续开发中的原型。将它用于正式工程决策前，请阅读
[当前限制](docs/zh-CN/reference/limitations.md)。

## 文档

- [概览](docs/zh-CN/index.md)
- [安装](docs/zh-CN/getting-started/installation.md)
- [Project 与资源](docs/zh-CN/guides/projects-and-resources.md)
- [AI 规划与审查](docs/zh-CN/guides/ai-plan-and-review.md)
- [运行监控与结果](docs/zh-CN/guides/run-and-results.md)
- [Case 对比](docs/zh-CN/guides/compare-cases.md)
- [配置参考](docs/zh-CN/reference/configuration.md)
- [故障排查](docs/zh-CN/reference/troubleshooting.md)
- [十分钟团队演示](docs/zh-CN/team/demo-script.md)
