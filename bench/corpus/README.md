# Commonwealth

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
# Set BOOTSTRAP_ADMIN_PASSWORD and BETTER_AUTH_SECRET with: openssl rand -base64 33
docker compose up --build
```

Sign in to the dashboard at `http://localhost:3001` with the configured bootstrap
email and password. Go to **Settings** to replace that password — it is a
first-boot credential, and until you change it your admin login is whatever is
sitting in `.env`. Additional administrators are added from the same screen, so
`BETTER_AUTH_ALLOW_SIGN_UP` can stay off.

Then create an MCP identity and API key. Configure MCP clients
to connect to `http://localhost:3000/mcp` with:

```text
Authorization: Bearer <your key>
```

The default embedding model is a small local baseline. `qwen3-embedding:0.6b`
is Apache-2.0 licensed and approximately 639 MB. Treat it as a baseline: use
the evaluation corpus described in `PLAN.md` before changing the default.

## Local development

```sh
pnpm install --frozen-lockfile
docker compose up -d postgres ollama ollama-init app
docker compose up admin-migrate
pnpm --filter @commonwealth/admin dev
```

The development server runs on the host and connects through `DATABASE_URL`, which
defaults to loopback Postgres. Containers use `COMPOSE_DATABASE_URL` and keep using
the Docker network hostname. Do not run the `admin` Compose service while using the
Vite development server; both use port 3001.

## License

GPL-3.0-only. See `LICENSE.md`.
