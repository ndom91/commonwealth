import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../db/schema.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const client = postgres(databaseUrl);

/* `drizzle()` mutates the client it is handed, in two ways that both surface as
   quiet wrong data rather than as errors.
 *
 * **Dates.** postgres.js parses `timestamptz` into a `Date`; after `drizzle()`
 * the same query returns raw Postgres text:
 *
 *     bare postgres.js     Date            → serializes 2026-07-24T16:30:00.313Z
 *     after drizzle()      string          → "2026-07-24 16:30:00.313448+00"
 *
 * That string is not ISO 8601 — a space where the `T` belongs, a two-digit
 * offset — and `Date.parse` on non-ISO input is implementation-defined. It is
 * read correctly by today's engines and would be read as *local time* by one
 * that chose differently, putting every timestamp out by the reader's offset.
 * So anything crossing into the UI goes through `isoUtc` in
 * `components/stamp.tsx`, which is the only place that turns one of these into
 * a string the rest of the app trusts.
 *
 * **jsonb.** It replaces postgres.js's serializer with a pass-through so it can
 * supply its own already-encoded JSON. That silently inverts how raw tagged
 * templates must write jsonb here versus in the MCP server, which holds a bare
 * postgres.js client:

     admin (this client)  `${JSON.stringify(x)}::jsonb`  — the string is written
                          verbatim and the cast parses it.
     MCP server (bare)    `${sql.json(x)}`               — the builtin serializer
                          encodes the object.
                          `${JSON.stringify(x)}::jsonb` there encodes twice and
                          stores a jsonb *string*.

   Neither form is correct on both clients, so the packages differ on purpose.
   Do not align them without also unpicking this mutation. */
export const db = drizzle(client, { schema });
export { client };
