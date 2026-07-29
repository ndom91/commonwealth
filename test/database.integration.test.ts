import assert from 'node:assert/strict';
import test from 'node:test';
import { AccessService } from '../src/access-service.js';
import { hashApiKey, keyPrefix } from '../src/auth.js';
import type { Config } from '../src/config.js';
import { KnowledgeRepository } from '../src/knowledge-repository.js';
import { runMigrations } from '../src/migrations.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : undefined;

if (!databaseUrl) {
  test.skip('database integration tests require TEST_DATABASE_URL');
} else if (databaseName !== 'commonwealth_test') {
  test('database integration tests require the dedicated commonwealth_test database', () => {
    throw new Error('TEST_DATABASE_URL must target the dedicated commonwealth_test database');
  });
} else {
  test('migrates, revises, filters, and retrieves knowledge', async () => {
    const config: Config = {
      DATABASE_URL: databaseUrl,
      OLLAMA_URL: 'http://unused',
      EMBEDDING_MODEL: 'test-embedding-model',
      PORT: 3000,
      MARKITDOWN_URL: 'http://unused',
      SOURCE_STORAGE_PATH: '/tmp/commonwealth-test',
      MAX_UPLOAD_BYTES: 1024,
      MAX_REQUEST_BYTES: 4096,
      /* Unused here — this test drives the repository directly and never goes
         through the HTTP surface the limiters guard — but `Config` is the whole
         environment, so it has to be complete. */
      TRUST_FORWARDED_FOR: false,
      RATE_LIMIT_KEY_WINDOW: 60,
      RATE_LIMIT_KEY_MAX: 120,
      RATE_LIMIT_ADDRESS_WINDOW: 60,
      RATE_LIMIT_ADDRESS_MAX: 600,
    };
    const embeddings = {
      async embed(texts: string[]): Promise<number[][]> {
        return texts.map((_, index) => Array.from({ length: 1024 }, () => index + 1));
      },
      async embedQuery(text: string): Promise<number[] | undefined> {
        return (await this.embed([text]))[0];
      },
    };
    const knowledge = new KnowledgeRepository(config, embeddings);
    const access = new AccessService(knowledge.sql);
    const bootstrapKey = 'test-bootstrap-key-that-is-long-enough';

    try {
      await knowledge.sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
      await runMigrations(knowledge.sql);
      const [workspace] = await knowledge.sql<{ id: string }[]>`
        INSERT INTO workspaces (name) VALUES ('test') RETURNING id
      `;
      assert.ok(workspace);
      const [user] = await knowledge.sql<{ id: string }[]>`
        INSERT INTO users (workspace_id, display_name, role) VALUES (${workspace.id}, 'Test Admin', 'admin') RETURNING id
      `;
      assert.ok(user);
      await knowledge.sql`
        INSERT INTO api_keys (user_id, key_prefix, secret_hash)
        VALUES (${user.id}, ${keyPrefix(bootstrapKey)}, ${hashApiKey(bootstrapKey)})
      `;
      const actor = await access.authenticate(bootstrapKey);
      assert.ok(actor);

      const source = await knowledge.submitNote(actor, {
        title: 'Billing API',
        markdown: '# Billing\n\nInvoices return error code BILLING_REQUIRED.',
        tags: ['billing'],
      });
      const revision = await knowledge.updateSource(actor, source.id, {
        title: 'Billing API v2',
        markdown: '# Billing\n\nInvoices return error code PAYMENT_REQUIRED.',
      });
      const history = (await knowledge.getSourceHistory(actor, source.id)) as Array<{
        revision_number: number;
        is_current: boolean;
      }>;
      const results = (await knowledge.search(actor, {
        query: 'PAYMENT_REQUIRED',
        tags: ['billing'],
        limit: 5,
        sourceType: 'note',
        explain: true,
      })) as Array<{ sourceId: string; revisionNumber: number; scores: { keywordScore: number } }>;

      assert.equal(revision.revisionNumber, 2);
      assert.equal(history.length, 2);
      assert.equal(history[0]?.is_current, true);
      assert.equal(results[0]?.sourceId, source.id);
      assert.equal(results[0]?.revisionNumber, 2);
      assert.ok(results[0]?.scores.keywordScore > 0);

      /* The lexical query is built by casting the query's own lexemes to
         tsquery. `to_tsvector` normalises first, so operators arrive as
         ordinary words — but that is the sort of claim worth holding a test
         against, since the failure mode is a query that throws for a caller
         who typed an ampersand. */
      for (const query of ['a & b | c ! (d)', "'; DROP TABLE chunks; --", '<script>x</script>']) {
        await assert.doesNotReject(
          () => knowledge.search(actor, { query, tags: [], limit: 5, explain: false }),
          `search should treat ${query} as text`
        );
      }
      const [surviving] = await knowledge.sql<{ chunks: string }[]>`
        SELECT count(*) AS chunks FROM chunks
      `;
      assert.ok(Number(surviving?.chunks) > 0, 'chunks survived');

      /* A question of nothing but stopwords normalises to an empty tsquery.
         Postgres matches nothing and ranks 0 for that, so the search degrades
         to semantic-only instead of failing. */
      const stopwords = await knowledge.search(actor, {
        query: 'the of and to',
        tags: [],
        limit: 5,
        explain: false,
      });
      assert.ok(Array.isArray(stopwords));
    } finally {
      await knowledge.close();
    }
  });
}
