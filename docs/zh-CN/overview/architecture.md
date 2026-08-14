# 本地与云端架构

Vibe Flow360 将本地交互层和远程计算分开。

```text
浏览器
  ↓ HTTP / SSE
本地 Go 服务
  ├── 内嵌 React 应用
  ├── AI 服务和分范围会话
  ├── 计划、批准与恢复状态
  ├── Project 镜像和可视化缓存
  └── Flow360 CLI 适配层
          ↓
      Flow360 Cloud
```

## 保留在本地的内容

- Web 应用和 HTTP 服务
- AI 对话与计划状态
- 导入的 STEP Library 元数据和文件
- Project 元数据镜像
- 已经打开的可视化资源
- 为收敛审查下载的小型 Case 历史数据

存储根目录默认为 `.vibesim`，可以通过 `VIBESIM_DATA_DIR` 修改。

## 保留在云端的内容

- 权威的 Flow360 Folder、Project、Draft、网格和 Case 资源
- 表面网格、体网格和求解器执行
- 尚未下载的云端状态与结果文件

Project 初次同步只读取元数据，不会自动复制大型 CAD、网格、体数据和 Case 结果压缩包。

## 信任边界

React 应用只调用本地服务，不会收到 Flow360 API Key。本地服务负责调用配置好的
Flow360 CLI。外部 Codex Agent 以临时、只读模式运行，并从其环境中移除 Flow360 与
AI 凭据。
