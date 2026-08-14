# 安装

## 环境要求

- Go 1.24 或更高版本
- Node.js 22 或更高版本
- Flow360 账号
- 当前初始化和发布流程支持 macOS 或 Linux

## 构建与初始化

在仓库根目录运行：

```bash
make build
./vibe-flow360 init
```

`make build` 会构建 React 应用并将其嵌入 Go 可执行文件。`init` 会准备固定版本的
`uv`、Python 3.11、Flow360 `25.10.*` 和 CadQuery 2.6.1，创建或更新 `.env`，验证
CLI，并执行一次只读的 Project 请求来检查登录状态。

如果没有可用凭据，交互式初始化会打开 Flow360 登录流程。无界面环境可以提供
`FLOW360_APIKEY` 并禁止打开浏览器：

```bash
FLOW360_APIKEY=your-key ./vibe-flow360 init --no-login
```

## 启动应用

```bash
./vibe-flow360 serve
```

打开 [http://localhost:9292](http://localhost:9292)。

如需使用其他地址或 dotenv 文件：

```bash
./vibe-flow360 serve --addr :9393 --env-file /absolute/path/to/.env
```

## 源码开发

启动后端：

```bash
go run -buildvcs=false ./cmd/server serve
```

在第二个终端启动 Vite：

```bash
cd web
npm install
npm run dev
```

Vite 会输出浏览器地址，并把 `/api` 代理到 `http://localhost:9292`。

下一步：[完成第一次仿真工作流](first-simulation.md)。
