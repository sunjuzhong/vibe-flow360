# 配置参考

`vibe-flow360 init` 会创建或更新 `.env`，但不会覆盖无关变量和注释。服务启动时，Shell
环境变量优先。

## Flow360

```dotenv
FLOW360_APIKEY=
VIBESIM_FLOW360_PROFILE=default
VIBESIM_FLOW360_ENV=
VIBESIM_FLOW360_BINARY=/absolute/path/to/flow360
VIBESIM_DATA_DIR=/absolute/path/to/.vibesim
```

如果凭据已经由 Flow360 登录保存，可以把 `FLOW360_APIKEY` 留空。空环境值表示生产环境，
也可以使用 `dev`、`uat` 或命名环境。`VIBESIM_FLOW360_BINARY` 通常由 `init` 写入。

如果服务可能从不同工作目录启动，建议为 `VIBESIM_DATA_DIR` 使用绝对路径。

## 时序播放器缓存

```dotenv
VIBESIM_SLICE_PLAYER_CACHE_MAX_BYTES=268435456000
VIBESIM_SLICE_PLAYER_CACHE_RETENTION_HOURS=720
```

Slice、Surface 归档及转换后的帧资源会按当前 Flow360 环境和 Profile 隔离。默认每个隔离缓存
最多使用 250 GiB，并保留 30 天未使用的条目。服务启动时及之后每六小时执行清理，优先淘汰
最近最少使用的条目，且不会删除正在准备或读取的资源。

## 内置或 OpenAI 兼容 Agent

```dotenv
VIBESIM_AGENT_PROVIDER=builtin
VIBESIM_AI_API_KEY=
VIBESIM_AI_BASE_URL=https://api.openai.com/v1
VIBESIM_AI_MODEL=gpt-4.1-mini
```

没有 AI API Key 时，内置 provider 可以在支持的规划场景中使用确定性本地规划器。
AI Create 必须配置模型服务。

## Codex CLI Agent

```dotenv
VIBESIM_AGENT_PROVIDER=codex
# Ask AI 面板的实验性流式模式：
# VIBESIM_AGENT_PROVIDER=codex-app-server
VIBESIM_CODEX_BINARY=codex
VIBESIM_CODEX_MODEL=
VIBESIM_CODEX_PROFILE=
VIBESIM_CODEX_TIMEOUT_SECONDS=300
```

Codex 以临时、只读沙箱运行。Flow360 和模型凭据会从子进程环境中移除。实验性的
`codex-app-server` provider 保持相同安全参数，但会把 Codex CLI 的助手输出实时流式发送到
`/api/agent/chat/stream`，Ask AI 面板可以先看到生成过程，而不是等待最终消息。

## CAD 运行环境

以下值通常由 `init` 管理：

```dotenv
VIBESIM_UV_BINARY=
VIBESIM_UV_CACHE_DIR=
VIBESIM_UV_PYTHON_INSTALL_DIR=
VIBESIM_CAD_PYTHON=3.11
VIBESIM_CAD_TIMEOUT_SECONDS=90
VIBESIM_CAD_OFFLINE=false
```

只有在需要指定本地运行环境或复用离线依赖时才需要修改。
