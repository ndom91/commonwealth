import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { member, user } from '../src/db/schema.js';
import { client, db } from '../src/lib/db.js';

/* Creating the first administrator is the one place sign-up must always be
   permitted. auth.ts reads BETTER_AUTH_ALLOW_SIGN_UP at import time and the
   running server keeps sign-up closed by default, so this script forces the
   flag for its own process and imports auth lazily afterwards. Without this,
   bootstrapping a fresh database outside Compose silently fails to create the
   administrator, and operators have to know about a global toggle to run a
   migration. */
process.env.BETTER_AUTH_ALLOW_SIGN_UP = 'true';
const { auth } = await import('../src/lib/auth.js');

const mcpBaselineHash = '41bf842e59b6710cf23897cde38427fd8f3f8f7a70e9261212c4bf1734b1d027';
const mcpBaselineTimestamp = 1784914839303;
const legacyMigrations = new Map([
  ['0001_initial.sql', 'd95eb64ea4107d4e6adbbe840798dc0952afc4e1759506990456efe321fdaf89'],
  ['0002_source_revisions.sql', '3d56a0e1c11579668d7f96f36bbdcf4a42f65a54d62624b709ead1cae27f2dce'],
  [
    '0003_normalize_source_payload.sql',
    '9410ff40f6e424ac77794f683a90dd03df4e3050c0689c3c076cf260e372bf14',
  ],
  [
    '0004_defer_initial_revision_constraint.sql',
    '06c1e6db175cc64cb8fc544b0106e4f9e15c86a4a5f9b600d7f7f504772063b4',
  ],
]);

const [legacyLedger] = await client<{ exists: boolean }[]>`
  SELECT to_regclass('schema_migrations') IS NOT NULL AS exists
`;
if (legacyLedger?.exists) {
  const applied = await client<
    { name: string; checksum: string }[]
  >`SELECT name, checksum FROM schema_migrations`;
  if (
    applied.length !== legacyMigrations.size ||
    applied.some(({ name, checksum }) => legacyMigrations.get(name) !== checksum)
  ) {
    throw new Error('Cannot cut over an unknown legacy MCP migration state');
  }
  const [dashboardInstalled] = await client<
    { exists: boolean }[]
  >`SELECT to_regclass('user') IS NOT NULL AS exists`;
  if (!dashboardInstalled?.exists) {
    await client.unsafe(
      await readFile(new URL('../drizzle/0000_bored_the_fury.sql', import.meta.url), 'utf8')
    );
  }
  await client`CREATE SCHEMA IF NOT EXISTS "drizzle"`;
  await client`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      "id" serial PRIMARY KEY NOT NULL,
      "hash" text NOT NULL,
      "created_at" bigint
    )
  `;
  await client`
    INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")
    SELECT ${mcpBaselineHash}, ${mcpBaselineTimestamp}
    WHERE NOT EXISTS (
      SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE "hash" = ${mcpBaselineHash}
    )
  `;
}

await migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });

/* Indexing runs in the admin process, not in a queue, so a source left
   `indexing` is one whose runner died with the process. Migrations run before
   the app starts, which makes this the one moment where that is certain: any
   such row cannot have a live runner. Marking it `failed` is what puts a Retry
   button in front of a human instead of a bar that never moves.
   Assumes a single admin process, which is what Compose runs. */
const stalled = await client`
  UPDATE sources SET status = 'failed' WHERE status = 'indexing' RETURNING id
`;
if (stalled.length > 0) {
  console.log(`Marked ${stalled.length} interrupted source(s) as failed; they can be retried.`);
}

const embeddingModel = process.env.EMBEDDING_MODEL;
if (!embeddingModel) throw new Error('EMBEDDING_MODEL is required');
/* `slug` is better-auth's, not ours — the organization plugin requires it and
   `workspaces` is the table it is pointed at. See `lib/auth.ts`.
 *
 * Conflict on the *slug*, not the name. The slug is the identity — it is in the
 * URL and never changes — while the name is a label an administrator may edit
 * from `/people`. Keying on the name would mean a renamed workspace no longer
 * matched, and this would try to insert a second one under the same slug.
 * `DO UPDATE SET slug` is a deliberate no-op: it changes nothing and lets
 * `RETURNING` fire on the row that already existed.
 *
 * The name here seeds *new* instances only. It used to be `default`, which
 * nobody chose and which became visible on the rail the moment workspaces went
 * plural; existing instances keep whatever they have. */
const [workspace] = await client<{ id: string }[]>`
  INSERT INTO workspaces (name, slug) VALUES ('Team knowledge base', 'default')
  ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
  RETURNING id
`;
if (!workspace) throw new Error('Unable to create default workspace');
/* Checked against the default workspace alone, and relied on instance-wide.
   That holds because there is one model for the whole instance: every other
   workspace gets its configuration copied from an existing one by
   `createWorkspace`, so they cannot disagree. If a model per workspace is ever
   attempted, this check has to grow with it. */
const [indexConfiguration] = await client<
  { embedding_model: string; embedding_dimensions: number }[]
>`
  SELECT embedding_model, embedding_dimensions FROM index_configuration WHERE workspace_id = ${workspace.id}
`;
if (!indexConfiguration) {
  await client`
    INSERT INTO index_configuration (workspace_id, embedding_model, embedding_dimensions)
    VALUES (${workspace.id}, ${embeddingModel}, 1024)
  `;
} else if (
  indexConfiguration.embedding_model !== embeddingModel ||
  indexConfiguration.embedding_dimensions !== 1024
) {
  throw new Error(
    'Embedding model differs from the existing index. Run a full reindex before changing EMBEDDING_MODEL.'
  );
}

const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (!email || !password)
  throw new Error('BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are required');

let [admin] = await db.select().from(user).where(eq(user.email, email));
if (!admin) {
  await auth.api.signUpEmail({
    body: { name: process.env.BOOTSTRAP_ADMIN_NAME ?? 'Admin', email, password },
  });
  [admin] = await db.select().from(user).where(eq(user.email, email));
}
if (!admin) throw new Error('Unable to bootstrap dashboard administrator');
/* The first person in has to be able to invite the rest, so `admin` — the only
   role that reaches the people register. Everyone after them is invited at
   whatever role the inviter chooses. */
await db
  .insert(member)
  .values({ organizationId: workspace.id, userId: admin.id, role: 'admin' })
  .onConflictDoNothing();
await client.end();
