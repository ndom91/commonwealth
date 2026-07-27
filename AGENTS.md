# Working in this repository

Notes an agent cannot infer from reading the code, and that cost real debugging
time when they were discovered.

## `src/` changes need a container rebuild

The MCP server runs from a built image, not a watcher. Editing anything under
`src/` has no effect on `http://localhost:3000/mcp` until:

```bash
docker compose up -d --build app
```

Nothing warns you. The server keeps answering with the code it was built with,
so a change looks silently ineffective rather than broken — a policy you just
added simply never fires. If a `src/` change appears not to work, rebuild
before debugging it.

The admin app is different: `pnpm dev` in `admin/` is a Vite dev server and
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
  `@valibot/to-json-schema`, wrapped as `input()` in `src/index.ts`). Valibot is
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

`@llm-team-kb/pipeline` (`packages/pipeline/`) holds chunking, embedding and
document conversion — the parts the MCP server and the admin must never
implement twice, because two embedders disagreeing on model or dimension
silently poisons the index rather than raising anything.

Its `exports` point at `.ts` files, so there is no build step to sequence in
either Dockerfile. In exchange, **only a TypeScript-aware runtime can import
it**: the server runs under `tsx`, the admin under Vite, tests under
`node --import tsx`. A throwaway script run with bare `node` fails with
`ERR_MODULE_NOT_FOUND` on `packages/pipeline/src/chunking.js` — the barrel's
`.js` specifier that only exists as `.ts`. Use `node --import tsx`.

Deliberately *not* shared: `knowledge-repository.ts`. It writes jsonb (see
below) and is bound to the MCP `Actor` permission model, so sharing it would be
wrong on the admin side in two separate ways. Each package keeps its own SQL.

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
`admin/src/components/stamp.tsx`, which normalises `Date`, the Postgres form and
plain ISO to one `Z`-suffixed string, and returns `null` rather than
`Invalid Date` for anything else. Render it with `<Stamp>`; there is no other
date helper.

### jsonb is written differently on each side

It replaces the jsonb serializer with a pass-through so it can supply its own
encoded JSON. That inverts how raw tagged templates must write jsonb:

| Package | Client | Correct form |
|---|---|---|
| `src/` (MCP server) | bare postgres.js | `${sql.json(x)}` |
| `admin/` | wrapped by Drizzle | `${JSON.stringify(x)}::jsonb` |

Using the other package's form does not error in either direction — it stores a
jsonb **string** instead of an object, which only shows up later as a field that
reads back `undefined`. There are rows in `events` from before this was
understood; `eventMetadata()` in `admin/src/lib/knowledge.ts` unwraps them.

Full explanation in `admin/src/lib/db.ts`. Do not align the two without
unpicking the mutation first.

## Fragments must come from the handle that runs them

Inside a `client.begin()` block, a fragment or `now()` built from the pooled
`client` is not the transaction's handle. The statement runs, writes nothing
where the fragment was, and reports success. Build fragments from the
`transaction` handle, or branch into separate statements. Read-only queries on
the pool are fine — see the shared `IS_STALE` / `NEEDS_REVIEW` fragments in
`admin/src/lib/knowledge.ts`.

## Indexing runs after the request that created the source

`writeNewSource` in `admin/src/lib/knowledge.ts` writes the source as
`indexing` and returns; `indexSource` embeds afterwards, without being awaited.
Three things follow from that:

- **Nothing in `indexSource` may touch the request.** `requireMember()` reads
  `getRequest()`, and by the time it runs the response has been sent. The member
  and workspace ids are passed in as arguments for this reason. The
  module-scoped `client` is unaffected and safe to use.
- **`active` is an invariant, not a default.** Every MCP read filters on
  `status = 'active'`, so it must mean "every chunk of the current revision is
  in the table". Anything that sets a source active — `indexSource`,
  `restoreSource` — has to establish that first, which is why `restoreSource`
  counts chunks against `chunkMarkdown` and restores to `failed` when they
  disagree.
- **A dead process leaves rows stuck.** There is no queue; the sweep at the top
  of `admin/scripts/migrate.ts` marks any surviving `indexing` row `failed` on
  the next migration, and Retry recovers it. This assumes one admin process.

`reviseSource` deliberately still embeds inline. A revision cannot use the same
mechanism, because the *current* revision stays live and good while a new one
indexes — the state would have to live on the revision, not the source.

## The workspace comes from the URL, and the server re-derives it

Every route under `admin/src/app/w/$slug/` is one corpus. The slug in the path is
the scope; `app/w/$slug.tsx` resolves it to a workspace and confirms membership
before any child renders. That layout is **not** the enforcement — it decides
what to draw. Every server function takes the same slug and re-checks it:

```ts
const { userId, workspaceId, role } = await requireMember('write', data.workspace);
```

`requireMember` resolves the slug and the membership in one query, so
authorisation and scoping can never disagree. Three rules follow:

- **Every server function that reads or writes workspace data takes a
  `workspace`.** `Scoped<T>` in `knowledge.ts` and `management.ts` is the type;
  `validateWorkspace` is the validator. The exceptions are `getSession`,
  `getWorkspaces`, and the two pre-account invitation functions, which have no
  caller-supplied workspace at all.
- **The predicate goes in the same `WHERE` as the id.** A query keyed by a source
  or identity id also filters `workspace_id`, so a foreign id answers "not found"
  instead of being fetched and then refused. This includes the `UPDATE`s that run
  after a scoped `SELECT` inside the same transaction — the guard is cheap and it
  survives someone moving the statements around later.
- **Nothing reads an "active workspace" from the session.** better-auth's
  organization plugin offers `session.activeOrganizationId` and it is deliberately
  unused: with the slug in the URL, a second source of truth is a way for the two
  to disagree.

A missing `workspace` is a *runtime* failure, not a compile error — the
validators take `unknown`. When adding a call site, check it passes one; the
sources loader shipped without it and typechecked cleanly.

`src/` needs none of this. It has always scoped to `actor.workspaceId`, so agents
were isolated before workspaces were visible in the browser. If a change here
seems to require one there, the scoping model is wrong.

## Two migration chains, on purpose

- `admin/drizzle/` is the **live schema**. `pnpm migrate` runs this. Anything
  the running system needs goes here.
- `db/migrations/` is applied only by `runMigrations` in
  `test/database.integration.test.ts`. It exists so the integration suite
  builds a schema the MCP server's code still matches.

A column the MCP server reads must ship in **both**. A column only the admin
reads ships in `admin/drizzle/` alone — and must, if it references a
better-auth table, since those do not exist in the test chain.

`admin/drizzle/meta/_journal.json` needs a matching entry for every new file.
The `legacyMigrations` checksum map in `admin/scripts/migrate.ts` describes a
frozen pre-cutover state; editing it breaks the cutover check for older
databases.

better-auth issues string ids, so `user.id` is `text`. A `uuid` foreign key
referencing it cannot be created.

## Running the tests

The integration test skips unless `TEST_DATABASE_URL` is set, and it refuses
any database not named `llm_team_kb_test` because it drops the public schema:

```bash
createdb llm_team_kb_test   # once; also needs CREATE EXTENSION vector
TEST_DATABASE_URL='postgres://team_kb:team_kb@localhost:5432/llm_team_kb_test' pnpm test
```

A bare `pnpm test` passes with the integration test skipped, which is easy to
mistake for coverage.

## Design changes

`admin/DESIGN.md` is the design record and is tracked. Its sidecar,
`admin/.impeccable/design.json`, is gitignored but should be kept in step —
new components and named rules belong in both.
