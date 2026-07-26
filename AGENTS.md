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
its client to Drizzle, and **`drizzle()` mutates the client it is given** — it
replaces the jsonb serializer with a pass-through so it can supply its own
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
