# LLM Team Knowledge Base

A self-hosted, source-cited knowledge base for MCP clients such as Claude Code,
OpenCode, and Cursor.

## Default stack

- Node.js and the MCP TypeScript SDK
- PostgreSQL with pgvector
- Ollama with `qwen3-embedding:0.6b` for local embeddings
- MarkItDown for document-to-Markdown conversion
- Optional Caddy reverse proxy for HTTPS

## Quick start

```sh
cp .env.example .env
# Set BOOTSTRAP_ADMIN_KEY in .env with: openssl rand -hex 32
docker compose up --build
```

The initial administrator key is generated from `BOOTSTRAP_ADMIN_KEY` on first
startup. It must be a unique secret; the sample environment file intentionally
leaves it blank. Configure MCP clients to connect to `http://localhost:3000/mcp` with:

```text
Authorization: Bearer <your key>
```

The default embedding model is a small local baseline. `qwen3-embedding:0.6b`
is Apache-2.0 licensed and approximately 639 MB. Treat it as a baseline: use
the evaluation corpus described in `PLAN.md` before changing the default.

## Local development

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Start Postgres and Ollama with Compose first, or set `DATABASE_URL` and
`OLLAMA_URL` to compatible services.

## License

GPL-3.0-only. See `LICENSE.md`.
