# Installation

## Requirements

- Go 1.24 or newer
- Node.js 22 or newer
- A Flow360 account
- macOS or Linux for the current bootstrap and release workflows

## Build and initialize

From the repository root:

```bash
make build
./vibe-flow360 init
```

`make build` builds the React application and embeds it in the Go executable.
`init` prepares a pinned `uv`, Python 3.11, Flow360 `25.10.*`, and CadQuery
2.6.1 runtime. It creates or updates `.env`, verifies the CLI, and performs a
read-only authenticated Project request.

If Flow360 credentials are not available, an interactive initialization opens
the Flow360 login flow. For a headless environment, provide `FLOW360_APIKEY`
and disable browser login:

```bash
FLOW360_APIKEY=your-key ./vibe-flow360 init --no-login
```

## Start the application

```bash
./vibe-flow360 serve
```

Open [http://localhost:9292](http://localhost:9292).

Use another address or dotenv file when needed:

```bash
./vibe-flow360 serve --addr :9393 --env-file /absolute/path/to/.env
```

## Develop from source

Start the backend:

```bash
go run -buildvcs=false ./cmd/server serve
```

In a second terminal, start Vite:

```bash
cd web
npm install
npm run dev
```

Vite prints its browser URL and proxies `/api` to `http://localhost:9292`.

Next: [complete the first simulation workflow](first-simulation.md).
