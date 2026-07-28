import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Sql } from 'postgres';

type Migration = { name: string; sql: string; checksum: string };

const migrationsDirectory = fileURLToPath(new URL('../db/migrations/', import.meta.url));

/* The lock key is a literal, and both services must use the *same* literal or
   they stop excluding each other. It changed with the rename, so the two images
   have to be deployed together — which the shipped compose does anyway, since
   both build from one tree and `admin-migrate` runs to completion before
   anything else starts. Worth knowing before hand-rolling a partial deploy. */
export async function runMigrations(sql: Sql): Promise<void> {
  const connection = await sql.reserve();
  try {
    await connection`SELECT pg_advisory_lock(hashtext('commonwealth:migrations'))`;
    await runMigrationsLocked(sql);
  } finally {
    await connection`SELECT pg_advisory_unlock(hashtext('commonwealth:migrations'))`.catch(
      () => undefined
    );
    connection.release();
  }
}

async function runMigrationsLocked(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const migrations = await loadMigrations();
  const applied = await sql<
    { name: string; checksum: string }[]
  >`SELECT name, checksum FROM schema_migrations`;
  const appliedByName = new Map(applied.map((migration) => [migration.name, migration.checksum]));

  if (applied.length === 0) {
    const legacySchema = await inspectLegacySchema(sql);
    if (legacySchema.anyTables && !legacySchema.complete) {
      throw new Error(`Legacy schema is incomplete: ${legacySchema.missing.join(', ')}`);
    }
    if (legacySchema.complete) {
      const initialMigration = migrations[0];
      if (!initialMigration) throw new Error('Initial migration is missing');
      await sql`
        INSERT INTO schema_migrations (name, checksum)
        VALUES (${initialMigration.name}, ${initialMigration.checksum})
      `;
      appliedByName.set(initialMigration.name, initialMigration.checksum);
    }
  }

  for (const migration of migrations) {
    const existingChecksum = appliedByName.get(migration.name);
    if (existingChecksum) {
      if (existingChecksum !== migration.checksum) {
        throw new Error(`Migration checksum mismatch for ${migration.name}`);
      }
      continue;
    }

    await sql.begin(async (transaction) => {
      await transaction.unsafe(migration.sql);
      await transaction`
        INSERT INTO schema_migrations (name, checksum)
        VALUES (${migration.name}, ${migration.checksum})
      `;
    });
  }
}

async function inspectLegacySchema(
  sql: Sql
): Promise<{ anyTables: boolean; complete: boolean; missing: string[] }> {
  const requiredColumns: Record<string, string[]> = {
    workspaces: ['id', 'name'],
    index_configuration: ['workspace_id', 'embedding_model', 'embedding_dimensions'],
    users: ['id', 'workspace_id', 'display_name', 'role'],
    api_keys: ['id', 'user_id', 'key_prefix', 'secret_hash'],
    sources: [
      'id',
      'workspace_id',
      'title',
      'source_type',
      'status',
      'authority',
      'content_hash',
      'markdown_content',
      'created_by',
    ],
    source_tags: ['source_id', 'tag'],
    chunks: ['id', 'source_id', 'ordinal', 'content', 'embedding', 'embedding_model'],
    events: ['id', 'workspace_id', 'event_type', 'metadata'],
  };
  const entries = Object.entries(requiredColumns);
  const tables = entries.map(([table]) => table);
  const rows = await sql<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ANY(${tables}::text[])
  `;
  const columnsByTable = new Map<string, Set<string>>();
  for (const row of rows) {
    const columns = columnsByTable.get(row.table_name) ?? new Set<string>();
    columns.add(row.column_name);
    columnsByTable.set(row.table_name, columns);
  }
  const missing = entries.flatMap(([table, columns]) =>
    columns
      .filter((column) => !columnsByTable.get(table)?.has(column))
      .map((column) => `${table}.${column}`)
  );
  return { anyTables: rows.length > 0, complete: missing.length === 0, missing };
}

async function loadMigrations(): Promise<Migration[]> {
  const names = (await readdir(migrationsDirectory)).filter((name) => name.endsWith('.sql')).sort();
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(`${migrationsDirectory}/${name}`, 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    })
  );
}
