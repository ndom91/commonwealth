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
concept and Git commit it came from, who vouched for it, and what it said before
the current commit.

## Positioning

Three things a neighbouring RAG or docs tool could not truthfully copy at once:

1. **Nothing leaves the host.** Embeddings run locally through llama.cpp; storage is
   local Postgres with pgvector. No vendor to trust, no egress for proprietary
   product knowledge.
2. **Provenance is a first-class primitive, not metadata.** Authority level,
   immutable Git commit history, append-only event log. A concept can be
   deprecated, but its prior commits remain in the workspace bundle.
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
  from Settings › People; the recipient chooses a password the issuer never sees. An
  invitation can never act on an address that already has an account — checked
  when issuing, when the link is opened, and again at redemption — because one
  that could would be an account-takeover primitive.
- **Credentials are first-boot, not permanent.** `BOOTSTRAP_ADMIN_PASSWORD` is
  expected to be rotated from Settings. Agent API keys are shown once at
  creation; only a prefix is ever stored or displayed.

## Capabilities and Constraints

The MCP tool list, the role names and the concept lifecycle are all readable from
`mcp-server/src/` and the migrations in a minute. What is not:

- **One role vocabulary for people and agents.** `reader` → read; `writer` →
  read and write; `reviewer` → adds authority changes and deletes; `admin` →
  all. The same four names govern an agent presenting an API key
   (`mcp-server/src/access-service.ts`) and a person signing in to the browser
   (`web/src/lib/roles.ts`), so "writer" means one thing. The two maps are
  duplicated by hand — separate deploy units — and must be changed together.
- **A writer's reach is scoped to its own work.** A writer may revise **only
  concepts it created**, and that holds even for a trusted holder whose
  submissions auto-approve. Loosening either boundary is a security decision,
  not a convenience one.
- **Hiding a control is not authorisation.** The drawer and the benches show a
  role only what it can act on, but every server function calls
  `requireMember(permission, workspace)` and refuses regardless. These are plain
  HTTP endpoints; anything relying on the UI to withhold them is not protected.
- **A workspace is a corpus, and nothing crosses between them.** One instance
  holds several — the AI team's notes and the core team's, separately — each with
  its own concepts, agent identities, review queue and activity log. Membership
  and role are per workspace: the same person can be an administrator in one and
  a reader in another. The workspace is in the URL (`/w/ai-team/sources`), so a
  pasted link means the same thing to everyone, and the server re-derives it from
  that slug on every call rather than from any remembered "active" workspace —
  two sources of truth is a way for them to disagree. A slug you are not a member
  of and one that does not exist get the same refusal, word for word.
- **A workspace's name can change; its slug cannot.** The name is a label — on
  the plate, in the switcher, on an invitation — and an administrator may edit it
  from Settings. The slug is in every link anyone has sent, and a URL that
  quietly stops meaning what it meant is a worse failure than a name nobody
  likes. Changing one would need a decision about redirects, not a text field.
- **Administering a workspace is one page with three tabs.** Its name, the
  people who can sign in to it, and the agent identities holding keys against it
  are the three faces of `/w/:slug/settings`. Your own display name and password
  are somewhere else entirely — `/w/:slug/account`, behind the signed-in name —
  because a preference is not a grant, and the two should never be one page.
- **Scoping lives in the `WHERE`, not after the fetch.** A query that takes an id
  carries `workspace_id` in the *same* predicate, so a foreign id reads as "not
  found" rather than being fetched and then refused. There is exactly one write in
   `web/src/lib` without a workspace predicate — claiming an invitation, found by
  token digest — and it is commented as such.
- **One index, one model.** Embeddings from different models must never be mixed
  in one index. Changing `EMBEDDING_MODEL` or the vector dimension requires
  reindexing every chunk, and `index_configuration` refuses a silent change.
   `qwen3-embedding-0.6b-q8_0-370f27d` is explicitly a replaceable baseline, not a choice the
  product is built around — and `pnpm bench` takes `EMBEDDING_MODEL` from the
  environment precisely so replacing it is a measured decision rather than a
  swap.
- **The indexed commit is the retrieval invariant.** `indexed_commit_sha` is
  the only snapshot MCP and admin reads may use. Indexing inserts all concepts
  and chunks for one commit before atomically publishing it; a failed run leaves
  the prior published commit searchable.
- **Embedding is the slow part** — roughly 0.7s a chunk, in sequence. A concept
  write waits for the resulting commit to index before reporting success.

### Undecided, on purpose

These are open product questions, not gaps to be closed by whoever notices them
next. Changing one is a decision, not a fix.

- **One embedding model for the whole instance, across all workspaces.**
   `concept_chunks.embedding` is `vector(1024)` for the entire table and `EMBEDDING_MODEL`
  is one process-wide variable read by both services, so a workspace cannot pick
  its own model without either giving up the fixed dimension (and the ANN index
  with it) or holding a chunk table per dimension. Separate corpora were the
  point of workspaces; separate *models* were not. Affirmed once since workspaces
  shipped and kept as it is — but it stays here rather than under Direction,
  because it is a standing constraint someone could reasonably want to lift, not
  a thing that is finished.

### Direction

The web surface is the primary human surface over this data, and the workbench
it was aimed at now ships: browse, search and read concepts; revise or deprecate
them; work a review queue; inspect Git history; audit the event log; invite
people and set what each of them may do — in any of several workspaces.
Settled, having been looked at and left as they are — not gaps waiting to be
closed by whoever notices them next:

- **Nothing moves between workspaces, and none can be deleted.** Moving a concept
  needs a re-embed and a decision about what the event log says happened;
  deleting a workspace would take its corpus with it by cascade, which deserves
  its own confirmation design. Reviewed and kept out.
- **Concept writes publish synchronously.** A write creates a Git commit, indexes
  that complete snapshot, and only then returns. This keeps an older indexed
  commit live if embedding fails; revisit when write latency makes a background
  publisher necessary.
- **Both colour schemes ship, and the reader picks.** Light was tokenised long
  before it was honest: it had auto-activated on `prefers-color-scheme` for anyone
  whose OS asked for it while the design system still described it as unshipped,
  and in it manila sat at 1.23:1 against the ground, so the material that means
  *issued* had quietly stopped being a material. It is now a full peer with its own
  measured values, and a sun/moon toggle in the rail footer pins a choice through
  an `httpOnly` cookie the server reads during SSR. Absent a pin the operating
  system still decides. This puts a browser floor on the product — `light-dark()`,
  so every engine from 2024 — which is a deliberate trade for a palette that cannot
  drift out of agreement with itself.
- **The bench states the corpus's custody standing at rest, and says nothing about
  it before you are signed in.** The default state of `/w/:slug/sources` — the
  surface where the recurring job happens — used to be a twelve-word instruction
  to click something, in half the viewport. It now reports what the register does
  not: the two populations owed a human kept apart, canonical and withdrawn counts,
  indexed passages, when the corpus was last vouched for, and when an agent last
  retrieved from it. That last figure is the first thing the admin surface says
  about *agent* behaviour rather than human curation, and a corpus nobody retrieves
  from is a different problem from one nobody curates. The threshold deliberately
  carries none of it: instance facts are not knowable before authentication and are
  nobody's business until then, so sign-in speaks only about what the product is.

Remaining known gaps, in rough order of how much they cost:

- **Retrieval is measured, but only against itself.** `pnpm bench` scores
  Recall@5, MRR, indexing throughput and query latency on a frozen corpus, and a
  first tuning wave used it — chunking on block boundaries, the heading in both
  halves of the index, the query side marked for asymmetric models, the lexical
  arm matching any term instead of every one, and finally rank fusion across the
  two arms. What it cannot say is whether a *different* model would do better:
  the harness reads `EMBEDDING_MODEL` from the environment and has only ever been
   pointed at one. Until a second model has been through it, `qwen3-embedding-0.6b-q8_0-370f27d`
  is a baseline that has been tuned around, not a choice that has been justified.
- **The operational half of the model gate is untouched.** RAM, image size and
  CPU cold-start, per `PLAN.md`. These decide whether the default is usable on a
  small self-hosted box, which is the deployment this product assumes.
- Nothing else outstanding at this size. Rate limiting closed the last of the
  unthrottled routes; the admin's session reads were the last obvious waste.

## Brand Commitments

- **The product is called Commonwealth.** Settled, after shipping for a while as
  the placeholder "LLM Team Knowledge Base". A commonwealth is property held in
  common by the people who use it and administered by them rather than owned
  over them — which is the whole argument of a self-hosted, source-cited corpus
  that agents write to and a team vouches for.
- **Nothing user-facing names the surface; it names where you are.** The plate
  reads the **workspace name** over **Commonwealth**, and the browser tab reads
  the page, the workspace, then the product — `Sources · Core Team —
  Commonwealth`. Signed out there is no workspace to name and the tab is bare
  **Commonwealth**, because no instance fact is anybody's business before
  authentication.
- **"Custody bench" is the design system's north star, not a name the product
  says out loud.** Chain-of-custody evidence handling is where the whole visual
  grammar comes from — an identity is a badge issued to a holder, a key is a
  sealed credential, revoking is voiding, the event log is the custody line — and
`web/DESIGN.md` documents it and is binding. It stopped being *shown* because
  it was the same phrase on every page of every workspace: true, and telling the
  reader nothing they could act on. The vocabulary it produced is still on the
  surface where it labels one specific thing — "Custody line", "In custody" —
  which is where it earns its keep.
- Agent credentials mint as `cw_…`. Keys issued before the rename mint as
  `tkb_…` and keep working — a live secret cannot be rewritten — so both
  markings will appear in an older instance's register indefinitely.
- License: GPL-3.0-only.
- No logo, wordmark, illustration, photography, or icon set exists in the repo.
- No confirmed voice guide. Existing copy is terse, concrete and unhedged
  ("Copy now. It will not be shown again.") — observed habit, not a ratified
  rule.

## Evidence on Hand

**Deliberately absent — do not fabricate:**

- **Retrieval numbers exist, and none of them may be published.** `pnpm bench`
  produces Recall@5, MRR, chunks/sec and p50/p95 latency, and they are real
  measurements — but of 32 hand-written questions against five of this repo's own
  documents, on whatever machine happened to run it, with one model. They exist to
  tell one commit from the next, which is the only claim they can carry. They are
  not a characterisation of the product, they say nothing about a real team's
  corpus, and a figure lifted out of a commit message and into a README becomes a
  claim the evidence does not support. **Never publish a quality or speed
  figure.** RAM, image size and CPU cold-start are not measured at all.
- No users, teams, adopters, testimonials, case studies, press, or stars.
- No pricing, hosted offering, support commitment, or SLA. Self-hosted only.
- No security audit or compliance certification.

## Product Principles

1. **Provenance over recall.** An answer a human can trace and vouch for beats a
   marginally better match. Where the two conflict, surface the chain.
2. **Never lose what was said.** Git commits are immutable, deprecation preserves
   history, and actions are logged. Nothing in the product may make history
   unrecoverable.
3. **Treat stored knowledge as untrusted input.** Content submitted by agents is
   reference material to be quoted, never instructions to be followed — in tool
   contracts and in anything the UI renders.
4. **Legible to someone who did not deploy it.** Any engineer on the team is a
   first-class user; the surface must not assume the operator's context or MCP
   fluency.
5. **Local and replaceable.** Data stays on the host, and every model or
   converter is a swappable default rather than a dependency the product is
   built around.
