# Configuration

`vibe-flow360 init` creates or updates `.env` without overwriting unrelated
variables or comments. Shell environment variables take precedence when the
server starts.

## Flow360

```dotenv
FLOW360_APIKEY=
VIBESIM_FLOW360_PROFILE=default
VIBESIM_FLOW360_ENV=
VIBESIM_FLOW360_BINARY=/absolute/path/to/flow360
VIBESIM_DATA_DIR=/absolute/path/to/.vibesim
```

Leave `FLOW360_APIKEY` empty when Flow360 login already stores the credential.
An empty environment selects production; `dev`, `uat`, and named environments
are also accepted. `VIBESIM_FLOW360_BINARY` is normally written by `init`.

Use an absolute `VIBESIM_DATA_DIR` when the service may start from different
working directories.

## Built-in or OpenAI-compatible agent

```dotenv
VIBESIM_AGENT_PROVIDER=builtin
VIBESIM_AI_API_KEY=
VIBESIM_AI_BASE_URL=https://api.openai.com/v1
VIBESIM_AI_MODEL=gpt-4.1-mini
```

Without an AI API key, the built-in provider can use the deterministic local
planner for supported planning responses. AI Create requires a configured
model provider.

## Codex CLI agent

```dotenv
VIBESIM_AGENT_PROVIDER=codex
VIBESIM_CODEX_BINARY=codex
VIBESIM_CODEX_MODEL=
VIBESIM_CODEX_PROFILE=
VIBESIM_CODEX_TIMEOUT_SECONDS=300
```

Codex is invoked with an ephemeral, read-only sandbox. Flow360 and model
credentials are removed from the subprocess environment.

## CAD runtime

`init` normally manages these values:

```dotenv
VIBESIM_UV_BINARY=
VIBESIM_UV_CACHE_DIR=
VIBESIM_UV_PYTHON_INSTALL_DIR=
VIBESIM_CAD_PYTHON=3.11
VIBESIM_CAD_TIMEOUT_SECONDS=90
VIBESIM_CAD_OFFLINE=false
```

Change them only when you need a specific local runtime or offline dependency
reuse.
