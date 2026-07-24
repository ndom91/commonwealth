import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { auth } from "../src/lib/auth.js";
import { db, client } from "../src/lib/db.js";
import { adminRole, user } from "../src/db/schema.js";

const mcpBaselineHash = "41bf842e59b6710cf23897cde38427fd8f3f8f7a70e9261212c4bf1734b1d027";
const mcpBaselineTimestamp = 1784914839303;
const legacyMigrations = new Map([
  ["0001_initial.sql", "d95eb64ea4107d4e6adbbe840798dc0952afc4e1759506990456efe321fdaf89"],
  ["0002_source_revisions.sql", "3d56a0e1c11579668d7f96f36bbdcf4a42f65a54d62624b709ead1cae27f2dce"],
  ["0003_normalize_source_payload.sql", "9410ff40f6e424ac77794f683a90dd03df4e3050c0689c3c076cf260e372bf14"],
  ["0004_defer_initial_revision_constraint.sql", "06c1e6db175cc64cb8fc544b0106e4f9e15c86a4a5f9b600d7f7f504772063b4"],
]);

const [legacyLedger] = await client<{ exists: boolean }[]>`
  SELECT to_regclass('schema_migrations') IS NOT NULL AS exists
`;
if (legacyLedger?.exists) {
  const applied = await client<{ name: string; checksum: string }[]>`SELECT name, checksum FROM schema_migrations`;
  if (applied.length !== legacyMigrations.size || applied.some(({ name, checksum }) => legacyMigrations.get(name) !== checksum)) {
    throw new Error("Cannot cut over an unknown legacy MCP migration state");
  }
  const [dashboardInstalled] = await client<{ exists: boolean }[]>`SELECT to_regclass('user') IS NOT NULL AS exists`;
  if (!dashboardInstalled?.exists) {
    await client.unsafe(await readFile(new URL("../drizzle/0000_bored_the_fury.sql", import.meta.url), "utf8"));
  }
  await client`
    CREATE SCHEMA IF NOT EXISTS "drizzle";
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

await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });

const embeddingModel = process.env.EMBEDDING_MODEL;
if (!embeddingModel) throw new Error("EMBEDDING_MODEL is required");
const [workspace] = await client<{ id: string }[]>`
  INSERT INTO workspaces (name) VALUES ('default')
  ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id
`;
if (!workspace) throw new Error("Unable to create default workspace");
const [indexConfiguration] = await client<{ embedding_model: string; embedding_dimensions: number }[]>`
  SELECT embedding_model, embedding_dimensions FROM index_configuration WHERE workspace_id = ${workspace.id}
`;
if (!indexConfiguration) {
  await client`
    INSERT INTO index_configuration (workspace_id, embedding_model, embedding_dimensions)
    VALUES (${workspace.id}, ${embeddingModel}, 1024)
  `;
} else if (indexConfiguration.embedding_model !== embeddingModel || indexConfiguration.embedding_dimensions !== 1024) {
  throw new Error("Embedding model differs from the existing index. Run a full reindex before changing EMBEDDING_MODEL.");
}

const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (!email || !password) throw new Error("BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are required");

let [admin] = await db.select().from(user).where(eq(user.email, email));
if (!admin) {
  await auth.api.signUpEmail({ body: { name: process.env.BOOTSTRAP_ADMIN_NAME ?? "Admin", email, password } });
  [admin] = await db.select().from(user).where(eq(user.email, email));
}
if (!admin) throw new Error("Unable to bootstrap dashboard administrator");
await db.insert(adminRole).values({ userId: admin.id }).onConflictDoNothing();
await client.end();
