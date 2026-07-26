import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../db/schema.js';

const client = postgres(process.env.DATABASE_URL!);

/* `drizzle()` mutates the client it is handed: it replaces postgres.js's jsonb
   serializer with a pass-through so it can supply its own already-encoded JSON.
   That silently inverts how raw tagged templates must write jsonb here versus
   in the MCP server, which holds a bare postgres.js client:

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
