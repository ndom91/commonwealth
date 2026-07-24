# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: any engineer on a team that self-hosts this instance.** Not only the
person who deployed it. They arrive through a link from a teammate or a README,
sign in with email and password, and expect the surface to be safe to use
without having read the source. Two distinct moments:

- **Credentialing** — mint an MCP identity and API key for their own agent
  (Claude Code, OpenCode, Cursor), or revoke one that leaked or belongs to
  someone who left. Infrequent, usually urgent, must not be gotten wrong.
- **Curating** — read, correct, and vouch for what the knowledge base tells
  agents. This is the recurring job and the reason the surface earns return
  visits.

**Secondary: the operator doing first-run setup.** Runs `docker compose up`,
generates `BOOTSTRAP_ADMIN_KEY`, and is the only account until they invite
others. Same person as a primary user afterwards.

**High-volume consumer: the agents themselves.** Agents read and write far more
than humans do, but only over MCP — they never touch the admin UI. Human
attention is the scarce resource; agent throughput is not.

## Product Purpose

Give a team one self-hosted, source-cited knowledge base that every MCP client
on the team can read from and write to, so agents answer from the team's own
documented truth instead of guessing or re-deriving it per session.

Success is that an engineer trusts an agent's answer because they can see which
source it came from, who vouched for that source, and what it said before it
was last revised.

## Positioning

Three things a neighboring RAG or docs tool could not truthfully copy at once:

1. **Nothing leaves the host.** Embeddings run locally through Ollama; storage
   is local Postgres with pgvector. There is no vendor to trust and no egress
   for proprietary product knowledge.
2. **Provenance is a first-class primitive, not metadata.** Every source carries
   an authority level (`canonical`, `approved`, `unverified`), an immutable
   revision chain, and an append-only event log. Revisions are never destructive
   and sources are only ever soft-deleted.
3. **Retrieved content is treated as untrusted by design.** Tool descriptions
   tell the calling model outright that submitted content is untrusted reference
   material and that returned excerpts are quoted references, not instructions.
   The prompt-injection surface of shared agent memory is addressed in the
   contract, not left to the client.

## Operating Context

- **Distribution:** open source, GPL-3.0-only. Other teams clone the repo and
  run it themselves. First boot must make sense to someone with zero context.
- **Deployment:** `docker compose up --build`. Services: `app` (MCP server),
  `admin` (this web surface), `admin-migrate`, `postgres` (pgvector), `ollama`
  + `ollama-init`, `markitdown`, `caddy` for optional HTTPS.
- **Endpoints:** MCP at `:3000/mcp`, admin UI at `:3001`.
- **Bootstrap:** the first administrator key is derived from
  `BOOTSTRAP_ADMIN_KEY` on first startup. `.env.example` leaves it blank on
  purpose; the operator generates it with `openssl rand -hex 32`.
- **Agent auth:** MCP clients send `Authorization: Bearer <key>`. Keys are shown
  once at creation and never again; the UI stores and displays only a prefix.
- **Human auth:** email and password via better-auth. Sign-up is disabled unless
  `BETTER_AUTH_ALLOW_SIGN_UP=true`, so the admin surface is closed by default.

## Capabilities and Constraints

**MCP tools today:** `submit_note`, `submit_document`, `update_source`,
`search_knowledge`, `get_source`, `get_source_history`, `set_source_authority`,
`delete_source`.

**Roles and permissions** (cumulative): `reader` → read; `writer` → read, write;
`reviewer` → read, write, review; `admin` → all. Writers may revise only sources
they created. Authority changes and deletes require reviewer.

**Source lifecycle:** submitted as `unverified`; promoted to `approved` or
`canonical` by a reviewer. Every edit creates an immutable revision rather than
overwriting. Deletion is a soft-delete. Actions append to an `events` table.

**Ingestion:** Markdown notes directly; other documents converted via
MarkItDown. Uploads capped at 10 MB (`MAX_UPLOAD_BYTES`), requests at 15 MB.

**Retrieval:** hybrid search over pgvector embeddings. Default model is
`qwen3-embedding:0.6b` (Apache-2.0, ~639 MB) and is explicitly a replaceable
baseline. Embeddings from different models must never be mixed in one index;
changing the model or dimension requires reindexing every chunk.

**Admin UI today:** sign-in, and one dashboard that creates identities with a
key and revokes keys. None of the reviewer, authority, revision, or search
capability above is reachable from the browser.

**Confirmed direction — full knowledge workbench.** The admin surface is
intended to become the primary human surface over this data: browse, search and
read sources; edit and revise them; run ingestion; work a review queue for
authority decisions; inspect revision history; and audit what agents retrieved
from the event log. *Sequencing across those areas is undecided.*

**Latent, not yet a product concept:** every row is scoped by `workspace_id`,
and an actor's workspace is derived from their key. No tool or screen lets
anyone choose or manage a workspace. *Whether multi-workspace becomes visible is
undecided;* treat the product as single-workspace until it is settled.

## Brand Commitments

- Name in use: **LLM Team Knowledge Base** (repo `llm-team-kb`). The admin UI
  currently reads "Team knowledge base" / "Control room". *Neither the product
  name nor a wordmark has been confirmed as final.*
- License: GPL-3.0-only, stated in `LICENSE.md` and `package.json`.
- No logo, wordmark, illustration, photography, or icon set exists in the repo.
- No confirmed voice guide. Existing copy is terse, concrete and unhedged
  ("Copy now. It will not be shown again.") — treat that as observed habit, not
  a ratified rule.

## Evidence on Hand

**Real:** `README.md` (quick start, stack, licensing), `PLAN.md` (embedding
decision and its reasoning), `LICENSE.md`, `compose.yaml`, and the working
implementation in `src/` and `admin/src/`. Integration tests in `test/`.

**Deliberately absent — do not fabricate:**

- No retrieval benchmarks. `PLAN.md` requires measuring Recall@5, MRR, indexing
  throughput, query latency, RAM, image size and CPU cold-start on a
  representative corpus *before* any model is called a release default. No such
  numbers have been produced. Never publish a quality or speed figure.
- No users, teams, adopters, testimonials, case studies, press, or stars.
- No pricing, hosted offering, support commitment, or SLA. Self-hosted only.
- No security audit or compliance certification.

## Product Principles

1. **Provenance over recall.** An answer a human can trace and vouch for beats a
   marginally better match. Where the two conflict, surface the chain.
2. **Never lose what was said.** Revisions are immutable, deletes are soft, and
   actions are logged. Nothing in the product may make history unrecoverable.
3. **Treat stored knowledge as untrusted input.** Content submitted by agents is
   reference material to be quoted, never instructions to be followed — in tool
   contracts and in anything the UI renders.
4. **Legible to someone who did not deploy it.** Any engineer on the team is a
   first-class user; the surface must not assume the operator's context or MCP
   fluency.
5. **Local and replaceable.** Data stays on the host, and every model or
   converter is a swappable default rather than a dependency the product is
   built around.
