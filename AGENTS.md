# Working in this repository

Notes an agent cannot infer from reading the code, and that cost real debugging
time when they were discovered.

## `mcp-server/src/` changes need a container rebuild

The MCP server runs from a built image, not a watcher. Editing anything under
`mcp-server/src/` has no effect on `http://localhost:3000/mcp` until:

```bash
docker compose up -d --build app
```

Nothing warns you. The server keeps answering with the code it was built with,
so a change looks silently ineffective rather than broken — a policy you just
added simply never fires. If an `mcp-server/src/` change appears not to work, rebuild
before debugging it.

The web app is different: `pnpm dev` in `web/` is a Vite dev server and
picks changes up on save. Server functions occasionally need a manual reload
of the page to re-run.

## The MCP SDK is pinned to an exact beta, deliberately

`@modelcontextprotocol/server` and `@modelcontextprotocol/node` are pinned to an
exact version with no caret. **Do not widen the range.** These are 2.x
pre-releases and breaking changes ship *between* betas — beta.5 alone relocated
`serverInfo` on the wire and changed two exported types. A caret range would
pick those up on an unrelated `pnpm install`.

We took a beta on purpose. Tool schemas here are valibot, and valibot reaches
`registerTool` through Standard Schema, which exists in no 1.x release: SDK 1.29
typed that parameter as `z3.ZodTypeAny | z4.$ZodType` and accepted nothing else.
The choice was a pinned beta or staying on zod.

Two consequences worth knowing before you touch a tool:

- **Valibot schemas must go through `toStandardJsonSchema`** (from
  `@valibot/to-json-schema`, wrapped as `input()` in `mcp-server/src/index.ts`). Valibot is
  the one Standard Schema library that doesn't carry JSON Schema conversion on
  the schema itself — Zod and ArkType are accepted bare. Pass a raw `v.object()`
  and registration still succeeds, but `tools/list` advertises an empty schema
  and every agent loses the argument contract. Nothing errors.
- **`strictObject`, not `object`.** It keeps `additionalProperties: false` in
  the advertised schema, matching what zod produced. It also means an invented
  argument is rejected rather than silently dropped — which for
  `search_knowledge` is the difference between an agent being told its filter
  was wrong and it receiving unfiltered results it believes were filtered.

`pnpm why zod` still returns hits. That's expected, not a regression: the SDK
depends on zod for the protocol's own schemas. What left is *our* use of it.

When 2.x reaches GA: unpin, expect type-level breakage on the way, and re-run
the `tools/list` schema comparison — the advertised JSON Schema is the contract
agents actually consume, so it is the thing worth diffing across the upgrade.

## The shared pipeline is TypeScript source, not a build

`@commonwealth/pipeline` (`packages/pipeline/`) holds chunking, embedding and
document conversion — the parts the MCP server and the admin must never
implement twice, because two embedders disagreeing on model or dimension
silently poisons the index rather than raising anything.

Its `exports` point at `.ts` files, so there is no build step to sequence in
either Dockerfile. In exchange, **only a TypeScript-aware runtime can import
it**: the server runs under `tsx`, the admin under Vite, tests under
`node --import tsx`. A throwaway script run with bare `node` fails with
`ERR_MODULE_NOT_FOUND` on `packages/pipeline/src/chunking.js` — the barrel's
`.js` specifier that only exists as `.ts`. Use `node --import tsx`.

`@commonwealth/corpus` is shared for Git bundle access and `indexWorkspace()`.
The indexer takes the workspace id and slug explicitly so it can be called from
either service without inheriting either service's request or permission model.
The MCP and admin repository wrappers keep their own authorisation and event
writes; only the commit-to-index pipeline is shared.

`@commonwealth/rate-limit` is the same arrangement and the same caveat.

## Rate limiting is in memory, and that is a choice with consequences

Three surfaces are limited: `POST /mcp` (`mcp-server/src/index.ts`), the two
unauthenticated invitation server functions (`web/src/lib/management.ts`), and
better-auth's own `/api/auth/*` (configured in `web/src/lib/auth.ts`).

All of them count in process memory. **Counters reset when a process restarts,
and two replicas of a service each get a full allowance.** That is fine for a
single-container deployment and is not fine for a scaled one — if a second `app`
or `admin` is ever run, this is the thing to move to shared storage first.
better-auth offers `storage: "database"` or `"secondary-storage"` for its half;
ours would need the equivalent.

For `/mcp` in particular, memory is not a compromise but the requirement. The
limiter runs *before* `access.authenticate`, whose job includes a `scryptSync`
per matching key row — on the event loop of a single-threaded server, at roughly
25ms each. A database-backed counter would do a query in order to avoid a query.

The key prefix is not a secret: it is the first twelve characters of the
credential and it is printed in the Identities register. Anyone who has seen a
key can send its prefix with a wrong secret and buy one scrypt per request. That
is why the per-credential bucket is keyed on the prefix rather than the whole
token — a hundred wrong secrets for one prefix share one allowance.

`TRUST_FORWARDED_FOR` defaults false for both services because Compose binds
them to loopback and ships no proxy. An operator who puts a trusted proxy in
front must set it true for that service. Reading a forwarded header with no
proxy in front lets any caller mint a fresh bucket per request by setting it,
which is worse than having no limiter, because it looks like one.

## Two Postgres clients that behave differently

Both packages use postgres.js against the same database, but the admin hands
its client to Drizzle, and **`drizzle()` mutates the client it is given**. It
does this to two things, and both fail quietly rather than loudly.

### Dates come back as strings, and not ISO ones

| Client | Same `timestamptz` column |
|---|---|
| bare postgres.js | `Date` → serializes `2026-07-24T16:30:00.313Z` |
| after `drizzle(client)` | string `2026-07-24 16:30:00.313448+00` |

Two consequences. `.toISOString()` on one of these throws, because it is not a
`Date`. And the string is **not ISO 8601** — space instead of `T`, two-digit
offset — so `Date.parse` on it is implementation-defined per ECMA-262. Today's
engines read it as UTC; one that read it as local time would shift every
timestamp in the product by the reader's own offset without erroring.

So **every timestamp reaching the UI goes through `isoUtc`** in
`web/src/components/stamp.tsx`, which normalises `Date`, the Postgres form and
plain ISO to one `Z`-suffixed string, and returns `null` rather than
`Invalid Date` for anything else. Render it with `<Stamp>`; there is no other
date helper.

### jsonb is written differently on each side

It replaces the jsonb serializer with a pass-through so it can supply its own
encoded JSON. That inverts how raw tagged templates must write jsonb:

| Package | Client | Correct form |
|---|---|---|
| `mcp-server/` | bare postgres.js | `${sql.json(x)}` |
| `web/` | wrapped by Drizzle | `${JSON.stringify(x)}::jsonb` |

Using the other package's form does not error in either direction — it stores a
jsonb **string** instead of an object, which only shows up later as a field that
reads back `undefined`. Event metadata is otherwise ordinary JSON and is read
directly by the activity surface.

Full explanation in `web/src/lib/db.ts`. Do not align the two without
unpicking the mutation first.

## Fragments must come from the handle that runs them

Inside a `client.begin()` block, a fragment or `now()` built from the pooled
`client` is not the transaction's handle. The statement runs, writes nothing
where the fragment was, and reports success. Build fragments from the
`transaction` handle, or branch into separate statements. Read-only queries on
the pool are fine.

## Indexing publishes complete Git commits

Git bundles are authoritative. `indexWorkspace()` reads one workspace `HEAD`,
embeds every indexable non-deprecated concept from that commit, then publishes
it by setting `workspace_index_state.indexed_commit_sha` inside the transaction
that inserted its `concepts` and `concept_chunks` rows. Every MCP and admin read
joins against that published commit. Three things follow from that:

- **The published commit is the retrieval invariant.** A concept is searchable
  only when every chunk from the same Git commit exists. An indexing failure
  leaves the previous published commit searchable and records `failed` state.
- **A newer commit wins without a partial handoff.** `indexing_commit_sha` is
  claimed before embedding and checked under a row lock before publication. A
  run superseded by a newer commit returns without replacing that newer state.
- **Writes wait for publication.** Admin and MCP concept mutations commit Git,
  index the resulting snapshot, and only then return success. There is no source
  ingestion queue or retry state in Postgres.

## The workspace comes from the URL, and the server re-derives it

Every route under `web/src/app/w/$slug/` is one corpus. The slug in the path is
the scope; `app/w/$slug.tsx` resolves it to a workspace and confirms membership
before any child renders. That layout is **not** the enforcement — it decides
what to draw. Every server function takes the same slug and re-checks it:

```ts
const { userId, workspaceId, role } = await requireMember('write', data.workspace);
```

`requireMember` resolves the slug and the membership in one query, so
authorisation and scoping can never disagree. Three rules follow:

- **Every server function that reads or writes workspace data takes a
  `workspace`.** `Scoped<T>` in `concepts.ts` and `management.ts` is the type;
  `validateWorkspace` is the validator. The exceptions are `getSession`,
  `getWorkspaces`, and the two pre-account invitation functions, which have no
  caller-supplied workspace at all.
- **The predicate goes in the same `WHERE` as the id.** A query keyed by an
  identity id also filters `workspace_id`, so a foreign id answers "not found"
  instead of being fetched and then refused. This includes the `UPDATE`s that run
  after a scoped `SELECT` inside the same transaction — the guard is cheap and it
  survives someone moving the statements around later.
- **Nothing reads an "active workspace" from the session.** better-auth's
  organization plugin offers `session.activeOrganizationId` and it is deliberately
  unused: with the slug in the URL, a second source of truth is a way for the two
  to disagree.

A missing `workspace` is a *runtime* failure, not a compile error — the
validators take `unknown`. When adding a call site, check it passes one; the
concept register loader shipped without it and typechecked cleanly.

`mcp-server/src/` needs none of this. It has always scoped to `actor.workspaceId`, so agents
were isolated before workspaces were visible in the browser. If a change here
seems to require one there, the scoping model is wrong.

## Two migration chains, on purpose

- `web/drizzle/` is the **live schema**. `pnpm migrate` runs this. Anything
  the running system needs goes here.
- `mcp-server/db/migrations/` is applied only by `runMigrations` in
  `mcp-server/test/database.integration.test.ts`. It exists so the integration suite
  builds a schema the MCP server's code still matches.

A column the MCP server reads must ship in **both**. A column only the admin
reads ships in `web/drizzle/` alone — and must, if it references a
  better-auth table, since those do not exist in the test chain.

`web/drizzle/meta/_journal.json` needs a matching entry for every new file. The
initial migration creates the full schema, including extensions and the tables
better-auth uses; `pnpm migrate` applies it and then idempotently seeds the first
administrator, workspace, and embedding configuration. Every future migration
needs a timestamp after `1786702198003`.

Do not add another schema bootstrap script or write to Drizzle's migration ledger
by hand. Schema belongs in `web/drizzle/`; environment-dependent bootstrap data
belongs in the post-migration seed in `web/scripts/migrate.ts`. Integration tests
must apply the Drizzle migration chain too, rather than loading schema SQL directly.

`web/src/db/schema.ts` does not yet declare every live table, extension, generated
column, or index. Do not run `drizzle-kit generate` for a live migration until it
does: its snapshot would be incomplete. Until then, add the SQL migration and its
journal entry by hand. Complete the Drizzle schema before adopting generated
migrations as the normal workflow.

better-auth issues string ids, so `user.id` is `text`. A `uuid` foreign key
referencing it cannot be created.

## Running the tests

The integration test skips unless `TEST_DATABASE_URL` is set, and it refuses
any database not named `commonwealth_test` because it drops the public schema:

```bash
createdb commonwealth_test   # once; also needs CREATE EXTENSION vector
TEST_DATABASE_URL='postgres://team_kb:team_kb@localhost:5432/commonwealth_test' pnpm test
```

A bare `pnpm test` passes with the integration test skipped, which is easy to
mistake for coverage.

## Design changes

`web/DESIGN.md` is the design record and is tracked. Its sidecar,
`web/.impeccable/design.json`, is gitignored but should be kept in step —
new components and named rules belong in both.
