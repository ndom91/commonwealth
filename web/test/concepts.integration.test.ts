import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import test from 'node:test';
import { commitFiles } from '@commonwealth/corpus';
import { indexProject } from '@commonwealth/corpus/indexer';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : undefined;

if (!databaseUrl) {
  test.skip('web integration tests require TEST_DATABASE_URL');
} else if (databaseName !== 'commonwealth_test') {
  test('web integration tests require the dedicated commonwealth_test database', () => {
    throw new Error('TEST_DATABASE_URL must target the dedicated commonwealth_test database');
  });
} else {
  test('scopes historical revisions and keeps retrieval inspection aligned with MCP', async () => {
    const corpusPath = '/tmp/commonwealth-web-concepts-integration-test';
    const sql = postgres(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.BETTER_AUTH_ALLOW_SIGN_UP = 'true';
    process.env.BETTER_AUTH_SECRET = 'integration-test-secret-that-is-long-enough-to-be-safe';
    process.env.BETTER_AUTH_URL = 'http://localhost:3001';

    try {
      await rm(corpusPath, { recursive: true, force: true });
      await sql.unsafe(
        'DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public'
      );
      const migrationClient = postgres(databaseUrl);
      await migrate(drizzle(migrationClient), {
        migrationsFolder: new URL('../drizzle', import.meta.url).pathname,
      });
      await migrationClient.end();

      const { auth } = await import('../src/lib/auth.js');
      const { readMembership } = await import('../src/lib/authorize.js');
      const { conceptVersion, inspectProject } = await import('../src/lib/concept-inspection.js');
      const { OkfRepository } = await import('../../mcp-server/src/okf-repository.js');

      const signUp = await auth.api.signUpEmail({
        body: {
          email: 'reader@example.com',
          name: 'Reader',
          password: 'correct horse battery staple',
        },
      });
      const [project] = await sql<{ id: string }[]>`
        INSERT INTO projects (name, slug) VALUES ('History', 'history') RETURNING id
      `;
      const [otherProject] = await sql<{ id: string }[]>`
        INSERT INTO projects (name, slug) VALUES ('Other', 'other') RETURNING id
      `;
      assert.ok(project && otherProject);
      await sql`
        INSERT INTO member (project_id, user_id, role) VALUES (${project.id}, ${signUp.user.id}, 'reader')
      `;
      await sql`
        INSERT INTO index_configuration (project_id, embedding_model, embedding_dimensions)
        VALUES (${project.id}, 'test-embedding-model', 1024)
      `;

      const initial = await commitFiles({
        actor: 'admin/test',
        corpusPath,
        files: [
          {
            path: 'playbooks/restart.md',
            text: '---\ntype: Playbook\ntitle: Original restart\ntags: [operations]\ncommonwealth:\n  authority: approved\nverified:\n  - at: 2026-08-01T12:00:00Z\n---\n\n# Restart\n\nRestart the original worker.\n',
          },
        ],
        subject: 'Create restart playbook',
        project: 'history',
      });
      await commitFiles({
        actor: 'admin/test',
        corpusPath,
        files: [
          {
            path: 'playbooks/restart.md',
            text: '---\ntype: Playbook\ntitle: Current restart\ntags: [operations]\ncommonwealth:\n  authority: canonical\n---\n\n# Restart\n\nRestart the current worker.\n',
          },
          {
            path: 'playbooks/unrelated.md',
            text: '---\ntype: Playbook\n---\n\n# Other\n\nUnrelated.\n',
          },
        ],
        subject: 'Revise restart playbook',
        project: 'history',
      });
      const unrelated = await commitFiles({
        actor: 'admin/test',
        corpusPath,
        files: [
          {
            path: 'playbooks/unrelated.md',
            text: '---\ntype: Playbook\n---\n\n# Other\n\nA later unrelated revision.\n',
          },
        ],
        subject: 'Revise unrelated playbook',
        project: 'history',
      });
      await indexProject({
        corpusPath,
        embeddingModel: 'test-embedding-model',
        embeddings: {
          embed: async (texts) => texts.map(() => Array.from({ length: 1024 }, () => 1)),
        },
        sql: (await import('../src/lib/db.js')).indexClient,
        projectId: project.id,
        projectSlug: 'history',
      });

      const membership = await readMembership('history', signUp.user.id);
      assert.ok(membership);
      assert.equal(await readMembership('other', signUp.user.id), null);
      const historical = await conceptVersion({
        commit: initial,
        corpusPath,
        path: 'playbooks/restart.md',
        project: 'history',
      });
      assert.equal(historical.authority, 'approved');
      assert.equal(historical.title, 'Original restart');
      assert.equal(historical.type, 'Playbook');
      assert.deepEqual(historical.tags, ['operations']);
      assert.equal(historical.last_verified_at, '2026-08-01T12:00:00Z');
      assert.match(historical.markdown, /original worker/);

      await assert.rejects(
        () =>
          conceptVersion({
            commit: unrelated,
            corpusPath,
            path: 'playbooks/restart.md',
            project: 'history',
          }),
        /not in this concept history/
      );

      const inspected = await inspectProject({
        embeddings: { embedQuery: async () => Array.from({ length: 1024 }, () => 1) },
        limit: 5,
        query: 'restart worker',
        sql,
        tags: ['operations'],
        type: 'Playbook',
        projectId: membership.projectId,
      });
      const [actor] = await sql<{ id: string }[]>`
        INSERT INTO users (project_id, display_name, role) VALUES (${project.id}, 'Agent', 'admin') RETURNING id
      `;
      assert.ok(actor);
      const repository = new OkfRepository(
        {
          CORPUS_PATH: corpusPath,
          DATABASE_URL: databaseUrl,
          EMBEDDING_MODEL: 'test-embedding-model',
          EMBEDDING_QUERY_INSTRUCTION: undefined,
          EMBEDDING_URL: 'http://embedding.test',
          MAX_REQUEST_BYTES: 1024,
          PORT: 3000,
          RATE_LIMIT_ADDRESS_MAX: 1,
          RATE_LIMIT_ADDRESS_WINDOW: 1,
          RATE_LIMIT_KEY_MAX: 1,
          RATE_LIMIT_KEY_WINDOW: 1,
          TRUST_FORWARDED_FOR: false,
        },
        { embed: async () => [], embedQuery: async () => Array.from({ length: 1024 }, () => 1) },
        sql
      );
      const mcp = await repository.search(
        { id: actor.id, role: 'admin', projectId: project.id },
        { explain: true, limit: 5, query: 'restart worker', tags: ['operations'], type: 'Playbook' }
      );
      assert.deepEqual(inspected, mcp);
      const [events] = await sql<{ count: string }[]>`
        SELECT count(*) FROM events WHERE project_id = ${project.id} AND event_type = 'search'
      `;
      assert.equal(Number(events?.count), 1, 'only the MCP search records a search event');
    } finally {
      const { client, indexClient } = await import('../src/lib/db.js');
      await Promise.all([client.end({ timeout: 1 }), indexClient.end({ timeout: 1 })]);
      await sql.end({ timeout: 1 });
      await rm(corpusPath, { recursive: true, force: true });
    }
  });
}
