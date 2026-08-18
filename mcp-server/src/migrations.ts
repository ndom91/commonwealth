import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Sql } from 'postgres';

type Migration = { name: string; sql: string; checksum: string };

const migrationsDirectory = fileURLToPath(new URL('../db/migrations/', import.meta.url));

/* The lock key is a literal, and both services must use the *same* literal or
   they stop excluding each other. It changed with the rename, so the two images
   have to be deployed together — which the shipped compose does anyway, since
    both build from one tree and `web-migrate` runs to completion before
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

async function loadMigrations(): Promise<Migration[]> {
  const names = (await readdir(migrationsDirectory)).filter((name) => name.endsWith('.sql')).sort();
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(`${migrationsDirectory}/${name}`, 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    })
  );
}
