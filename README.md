# Commonwealth

A self-hosted knowledge base that gives MCP clients source-cited answers.

![Concept Screenshot](./github/assets/screenshot_001.png)

## Quick start

```sh
cp .env.example .env
# Set BOOTSTRAP_ADMIN_PASSWORD and BETTER_AUTH_SECRET with: openssl rand -base64 33
docker compose up --build
```

Sign in to the dashboard at `http://localhost:3001` with the bootstrap credentials.
Replace the bootstrap password from **Settings** immediately. It is a first-boot
credential, and further administrators are added from the same screen.

Create an MCP identity and API key, then configure your MCP client with:

```text
Authorization: Bearer <your key>
```

The default Apache-2.0 `Qwen3-Embedding-0.6B-Q8_0.gguf` model is about 639 MB.
Compose downloads it once into the `embedding_models` volume and verifies its
configured SHA-256 before inference starts. See [`docs/inference.md`](docs/inference.md)
to replace the model or use GPU acceleration. Run `pnpm bench` before and after
changing models to compare retrieval against the frozen corpus.

## Deployment

Compose binds the MCP server and web app to loopback. Put your existing
reverse proxy in front of them for public access; examples are in
[`docs/proxy/`](docs/proxy/). Set `APP_TRUST_FORWARDED_FOR=true` and/or
`WEB_TRUST_FORWARDED_FOR=true` only for a service reached through that trusted
proxy. Cloudflare orange-cloud deployments also set the matching
`*_FORWARDED_IP_HEADER=cf-connecting-ip` value.

## License

GPL-3.0
