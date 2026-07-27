# Product

<!-- impeccable:product-schema 1 -->

This file holds product intent, decisions and their reasoning — the things that
cannot be recovered by reading the code. Anything discoverable in a minute from
`compose.yaml`, the migrations, or a grep does not belong here. Architectural
gotchas live in `AGENTS.md`; the embedding decision lives in `PLAN.md`.

## Platform

web

## Users

**Primary: any engineer on a team that self-hosts this instance.** Not only the
person who deployed it. They arrive through a link from a teammate or a README,
sign in, and expect the surface to be safe to use without having read the
source. Two distinct moments:

- **Credentialing** — mint an MCP identity and API key for their own agent, or
  revoke one that leaked. Infrequent, usually urgent, must not be gotten wrong.
- **Curating** — read, correct, and vouch for what the knowledge base tells
  agents. This is the recurring job and the reason the surface earns return
  visits.

**Secondary: the operator doing first-run setup.** Same person as a primary user
afterwards.

**High-volume consumer: the agents themselves.** They read and write far more
than humans, but only over MCP — never the admin UI. Human attention is the
scarce resource; agent throughput is not.

## Product Purpose

Give a team one self-hosted, source-cited knowledge base that every MCP client
on the team can read from and write to, so agents answer from the team's own
documented truth instead of guessing or re-deriving it per session.

Success is that an engineer trusts an agent's answer because they can see which
source it came from, who vouched for that source, and what it said before it was
last revised.

## Positioning

Three things a neighbouring RAG or docs tool could not truthfully copy at once:

1. **Nothing leaves the host.** Embeddings run locally through Ollama; storage is
   local Postgres with pgvector. No vendor to trust, no egress for proprietary
   product knowledge.
2. **Provenance is a first-class primitive, not metadata.** Authority level,
   immutable revision chain, append-only event log. Revisions are never
   destructive and sources are only ever soft-deleted.
3. **Retrieved content is treated as untrusted by design.** Tool descriptions
   tell the calling model outright that submitted content is untrusted reference
   material and returned excerpts are quoted references, not instructions. The
   prompt-injection surface of shared agent memory is addressed in the contract,
   not left to the client.

## Operating Context

- **Distribution:** open source, GPL-3.0-only. Other teams clone the repo and run
  it themselves, so first boot must make sense to someone with zero context and
  every default must be defensible without a conversation.
- **Human auth is closed by default, and the flag is the only thing holding it
  closed.** `disableSignUp` is enforced *inside* better-auth's handler, not by
  routing: `POST /api/auth/sign-up/email` is a live unauthenticated endpoint that
  answers `EMAIL_PASSWORD_SIGN_UP_DISABLED`. Turning `BETTER_AUTH_ALLOW_SIGN_UP`
  on opens account creation to anyone who can reach the instance, whether or not
  a sign-up page exists. It is for the bootstrap script. Teammates arrive by
  invitation, with the flag off.
- **Nobody hands anyone a password.** Adding a teammate mints a single-use link
  from `/people`; the recipient chooses a password the issuer never sees. An
  invitation can never act on an address that already has an account — checked
  when issuing, when the link is opened, and again at redemption — because one
  that could would be an account-takeover primitive.
- **Credentials are first-boot, not permanent.** `BOOTSTRAP_ADMIN_PASSWORD` is
  expected to be rotated from Settings. Agent API keys are shown once at
  creation; only a prefix is ever stored or displayed.

## Capabilities and Constraints

The MCP tool list, the role names and the source lifecycle are all readable from
`src/` and the migrations in a minute. What is not:

- **One role vocabulary for people and agents.** `reader` → read; `writer` →
  read and write; `reviewer` → adds authority changes and deletes; `admin` →
  all. The same four names govern an agent presenting an API key
  (`src/access-service.ts`) and a person signing in to the browser
  (`admin/src/lib/roles.ts`), so "writer" means one thing. The two maps are
  duplicated by hand — separate deploy units — and must be changed together.
- **A writer's reach is scoped to its own work.** A writer may revise **only
  sources it submitted**, and that holds even for a trusted holder whose
  submissions auto-approve. Loosening either boundary is a security decision,
  not a convenience one.
- **Hiding a control is not authorisation.** The drawer and the benches show a
  role only what it can act on, but every server function calls
  `requireMember(permission)` and refuses regardless. These are plain HTTP
  endpoints; anything relying on the UI to withhold them is not protected.
- **One index, one model.** Embeddings from different models must never be mixed
  in one index. Changing `EMBEDDING_MODEL` or the vector dimension requires
  reindexing every chunk, and `index_configuration` refuses a silent change.
  `qwen3-embedding:0.6b` is explicitly a replaceable baseline, not a choice the
  product is built around.
- **`active` is an invariant, not a default.** It is the only status any MCP read
  returns, so it has to mean *every chunk of the current revision is in the
  table*. Admin-created sources pass through `indexing`, and land `failed` if
  that run dies. Anything that sets a source active must establish the invariant
  first.
- **Embedding is the slow part** — roughly 0.7s a chunk, in sequence. Uploads
  index after the request returns, so a long document keeps going while the
  browser is elsewhere.

### Undecided, on purpose

These are open product questions, not gaps to be closed by whoever notices them
next. Changing one is a decision, not a fix.

- **Workspaces are one deep.** The membership model is per-workspace and
  better-auth's `organization` plugin is mapped onto the `workspaces` table, but
  only the `default` workspace exists and no admin query filters by one. Agents
  are already scoped — `src/access-service.ts` has always used
  `actor.workspaceId` — so the gap is entirely on the browser side. *Treat the
  product as single-workspace until that lands.*
- **The product name.** "LLM Team Knowledge Base" (repo `llm-team-kb`) is in use
  but has never been confirmed final.

### Direction

The admin surface is the primary human surface over this data, and the workbench
it was aimed at now ships: browse, search and read sources; revise them; run
ingestion; work a review queue; inspect revision history; audit the event log;
invite people and set what each of them may do. Remaining known gaps, in rough
order of how much they cost:

- **Several workspaces.** Creating and switching them, scoping every admin query
  to the active one, and per-workspace embedding configuration so a team can
  pick its own model. This is the next substantial wave.
- Revisions still embed inside the request, unlike uploads. A revision cannot
  reuse the same mechanism, because the *current* revision stays live and correct
  while a new one indexes — the state would have to live on the revision.
- `acceptInvitation` has no rate limit. A 256-bit token is not guessable, but
  the route is unauthenticated and unthrottled.
- No retrieval quality work has happened at all. See below.

## Brand Commitments

- The admin UI reads **Team knowledge base** / **Custody bench**. The design
  system is documented in `admin/DESIGN.md` and is binding.
- License: GPL-3.0-only.
- No logo, wordmark, illustration, photography, or icon set exists in the repo.
- No confirmed voice guide. Existing copy is terse, concrete and unhedged
  ("Copy now. It will not be shown again.") — observed habit, not a ratified
  rule.

## Evidence on Hand

**Deliberately absent — do not fabricate:**

- **No retrieval benchmarks.** `PLAN.md` requires measuring Recall@5, MRR,
  indexing throughput, query latency, RAM, image size and CPU cold-start on a
  representative corpus *before* any model is called a release default. No such
  numbers exist. **Never publish a quality or speed figure.**
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
