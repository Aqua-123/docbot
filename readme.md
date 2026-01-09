![docbot header](https://ltwtljxsstgqk8ay.public.blob.vercel-storage.com/docbot.jpg)

# Docbot

[![npm version](https://img.shields.io/npm/v/@helmlabs/docbot)](https://www.npmjs.com/package/@helmlabs/docbot)

Docbot is a CLI agent that helps you keep documentation up to date.

It reads your docs + codebase, proposes a concrete plan (file-level operations), and only writes changes after you approve.

## Notes on speed (and why it's still worth it)

- Indexing can feel a bit slow right now; running a full cycle across a bunch of pages may take 5–10 minutes, but that's still way faster than the hours you'd spend doing it by hand
- Overall flow is under-optimized today; expect it to improve soon (again, the time and token costs are still much lower than manual work, at least for us)

## Install

```bash
bunx @helmlabs/docbot --help
```

(Optional) global:

```bash
bun add -g @helmlabs/docbot
docbot --help
```

## Quick Start

```bash
# qdrant (required)
docker run --rm -p 6333:6333 -v "$(pwd)/qdrant_storage:/qdrant/storage" qdrant/qdrant

# config + local state (.docbot/, docbot.config.jsonc)
bunx @helmlabs/docbot init

# index docs/code (uses config; CLI flags override)
bunx @helmlabs/docbot index

# run the agent
bunx @helmlabs/docbot run "document the settings page"
```

## What It Does

- **Codebase-aware doc work**: finds gaps/stale pages by reading your code, not vibes
- **Search that's actually useful**: semantic + exact match, reranked
- **Interactive planning**: you approve the plan before anything touches your files
- **MDX-first output**: structured edits instead of “giant blob rewrite”
- **TUI + API**: run with a terminal UI, or start the HTTP server only

## Requirements

Required:

- [Bun](https://bun.sh)
- [Qdrant](https://qdrant.tech) (local via Docker or remote - `docbot init` will set you up with a local instance via Docker)
- `rg` (ripgrep) for fast exact-match search
- API key for your chosen provider (see [Provider Configuration](#provider-configuration))

## How It Works

1. **Analysis**: scan docs + codebase, find gaps/duplicates/stale content
2. **Planning**: propose a structured set of operations (create/update/move/delete/consolidate)
3. **Execution**: apply changes (MDX edits, component-aware when relevant)
4. **Review**: verify and re-scan for obvious misses

## Dependencies & Design Choices

Docbot is opinionated so we were able to build it fast, but it's not meant to stay tied to a single docs framework or provider forever.

- **Docs frameworks**: Today Docbot targets MDX-based doc sites and detects Mintlify project structure automatically (as long as you use `docs.json`). Mintlify was the first target because that's what we use at Helm; support will expand (custom MDX, Fumadocs, Nextra, Docusaurus, etc.). It's just a matter of tweaking the tools and prompts.
- **Vector store**: Currently Qdrant (required). It's easy to run locally and does the job well. This may evolve as CI/multi-user needs grow.
- **Models/provider**: Defaults to Vercel AI Gateway (`AI_GATEWAY_API_KEY`). Alternatively, configure native providers (OpenAI, Anthropic, Google, Groq) or any OpenAI-compatible endpoint (LM Studio, Ollama, vLLM, self-hosted models). See [Provider Configuration](#provider-configuration).
- **Bun**: Required. Will not change.

## Commands

### `docbot init`

Scaffolds project config in the repo root:

- `.docbot/`
- `docbot.config.jsonc`

```bash
docbot init
```

Options:

- `--force`: overwrite existing config
- `--skip-docker`: skip docker setup (you'll need to set up Qdrant manually)

### `docbot index`

Indexes docs/code for search. If you don't pass flags, it uses your config.

```bash
docbot index
# or
docbot index --docs ./docs --codebase ./src
```

Options:

- `--docs`: docs path (optional if configured)
- `--codebase`: one or more codebase paths
- `--config`: config file path (default: `docbot.config.jsonc`)
- `--qdrant-url`: qdrant url (default: [http://127.0.0.1:6333](http://127.0.0.1:6333))
- `--force`: force full re-index, ignoring manifest

### `docbot run "<task>"`

Runs the interactive workflow (plan → approval → execution → review).

```bash
docbot run "document the new api endpoints"
```

Options:

- `--docs`: docs path (optional if configured)
- `--codebase`: one or more codebase paths
- `--config`: config file path (default: `docbot.config.jsonc`)
- `--interactive`: plan approval (default: true)
- `--port`: server port (default: 3070)
- `--qdrant-url`: qdrant url (default: [http://127.0.0.1:6333](http://127.0.0.1:6333))
- `--index-only`: only index, don't run
- `--verbose` / `--no-verbose`: detailed logging + log panel
- `--no-server`: reuse an already running server
- `--force`: rebuild embeddings from scratch

### `docbot search "<query>"`

```bash
docbot search "authentication" --type hybrid --limit 10
```

Options:

- `--type`: `semantic`, `exact`, `hybrid` (default: `hybrid`)
- `--limit`: max results (default: 5)

### `docbot serve`

Starts the HTTP server (Elysia) without the TUI.

```bash
docbot serve --port 3070
```

## Configuration

`docbot init` creates `docbot.config.jsonc`. CLI flags override config.

Example:

```jsonc
{
  "projectSlug": "my-project",
  "paths": {
    "docs": "./docs",
    "codebase": ["./apps/web", "./packages/shared"]
  },
  "qdrant": {
    "url": "http://127.0.0.1:6333"
  },
  "server": { "port": 3070 },
  "models": {
    "planning": "openai/gpt-5.2",
    "prose": "anthropic/claude-sonnet-4.5",
    "fast": "openai/gpt-5.2",
    "nano": "google/gemini-3-flash",
    "embedding": "openai/text-embedding-3-small"
  }
}
```

CLI flags take precedence over the config file. See [Provider Configuration](#provider-configuration) for setting up different LLM providers.

## Provider Configuration

Docbot supports multiple LLM providers. By default, it uses Vercel AI Gateway. You can configure native providers or custom OpenAI-compatible endpoints.

### Default: Vercel AI Gateway

When no `providers` are configured, Docbot uses Vercel AI Gateway. Set your API key:

```bash
export AI_GATEWAY_API_KEY=your-gateway-key
```

### Native Providers

Configure native providers (OpenAI, Anthropic, Google, Groq) by adding them to the `providers` array. When any provider is configured, Docbot switches from gateway mode to native mode.

**Environment Variables:**

| Provider | Environment Variable |
|----------|---------------------|
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Google | `GOOGLE_GENERATIVE_AI_API_KEY` |
| Groq | `GROQ_API_KEY` |

**Example: Using OpenAI and Anthropic directly**

```jsonc
{
  "providers": [
    { "type": "openai" },
    { "type": "anthropic" }
  ],
  "models": {
    "planning": "openai/gpt-5.2",
    "prose": "anthropic/claude-sonnet-4.5",
    "fast": "openai/gpt-5.2",
    "nano": "google/gemini-3-flash",
    "embedding": "openai/text-embedding-3-small"
  }
}
```

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
```

### OpenAI-Compatible Endpoints

Use any OpenAI-compatible API (Ollama, LM Studio, vLLM, self-hosted models) with the `openai-compatible` provider type.

**Example: Ollama (local)**

Note: Ensure you have an embedding model available in Ollama (e.g., `ollama pull nomic-embed-text`).

```jsonc
{
  "providers": [
    {
      "type": "openai-compatible",
      "name": "ollama",
      "baseURL": "http://localhost:11434/v1"
    }
  ],
  "models": {
    "planning": "ollama/llama3.1:70b",
    "prose": "ollama/llama3.1:70b",
    "fast": "ollama/llama3.1:8b",
    "nano": "ollama/llama3.1:8b",
    "embedding": "ollama/nomic-embed-text"
  }
}
```

**Example: LM Studio**

```jsonc
{
  "providers": [
    {
      "type": "openai-compatible",
      "name": "lmstudio",
      "baseURL": "http://localhost:1234/v1"
    }
  ],
  "models": {
    "planning": "lmstudio/loaded-model",
    "prose": "lmstudio/loaded-model",
    "fast": "lmstudio/loaded-model",
    "nano": "lmstudio/loaded-model",
    "embedding": "lmstudio/loaded-model"
  }
}
```

**Example: Custom API with authentication**

```jsonc
{
  "providers": [
    {
      "type": "openai-compatible",
      "name": "myapi",
      "baseURL": "https://api.example.com/v1",
      "apiKey": "your-api-key",
      "headers": {
        "X-Custom-Header": "value"
      }
    }
  ],
  "models": {
    "planning": "myapi/my-model",
    "prose": "myapi/my-model",
    "fast": "myapi/my-model",
    "nano": "myapi/my-model",
    "embedding": "myapi/my-model"
  }
}
```

### Mixing Providers

You can combine native providers with custom endpoints:

```jsonc
{
  "providers": [
    { "type": "openai" },
    {
      "type": "openai-compatible",
      "name": "ollama",
      "baseURL": "http://localhost:11434/v1"
    }
  ],
  "models": {
    "planning": "openai/gpt-5.2",
    "prose": "openai/gpt-5.2",
    "fast": "ollama/llama3.1:8b",
    "nano": "ollama/llama3.1:8b",
    "embedding": "openai/text-embedding-3-small"
  }
}
```

```bash
export OPENAI_API_KEY=sk-...
```

## Logs & UI

- **Run (default)**: TUI + server in one process (verbose by default; log panel available)
- **Serve**: server only; logs to stdout
- **Index-only**: `--index-only`
- **No-server**: `--no-server`

Log panel (TUI, verbose only):

- Toggle: `Ctrl+L`
- Tabs: `←/→`
- Scroll: `Shift+↑/↓` or `Shift+PgUp/PgDn`
- Clear: `C`

## Contributing

PRs welcome. Issues welcome.

## Support

- This is a very new project—if you hit issues, please open an issue here
- You can also reach celia on X: [@pariscestchiant](https://x.com/pariscestchiant)
- Our own docs live at [docs.helmkit.com](https://docs.helmkit.com)

## License

MIT

## Todo

Tasks and progress are tracked in [todo.md](todo.md). Next big focus is changebot's integration inside of docbot (it's a changelog generator between two commits; we use it at [helmkit.com/changelog](https://helmkit.com/changelog))
