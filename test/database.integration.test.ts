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
} else if (databaseName !== 'llm_team_kb_test') {
  test('database integration tests require the dedicated llm_team_kb_test database', () => {
    throw new Error('TEST_DATABASE_URL must target the dedicated llm_team_kb_test database');
  });
} else {
  test('migrates, revises, filters, and retrieves knowledge', async () => {
    const config: Config = {
      DATABASE_URL: databaseUrl,
      OLLAMA_URL: 'http://unused',
      EMBEDDING_MODEL: 'test-embedding-model',
      PORT: 3000,
      MARKITDOWN_URL: 'http://unused',
      SOURCE_STORAGE_PATH: '/tmp/llm-team-kb-test',
      MAX_UPLOAD_BYTES: 1024,
      MAX_REQUEST_BYTES: 4096,
    };
    const embeddings = {
      async embed(texts: string[]): Promise<number[][]> {
        return texts.map((_, index) => Array.from({ length: 1024 }, () => index + 1));
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
      const [user] = await knowledge.sql<{ id: string }[]>`
        INSERT INTO users (workspace_id, display_name, role) VALUES (${workspace!.id}, 'Test Admin', 'admin') RETURNING id
      `;
      await knowledge.sql`
        INSERT INTO api_keys (user_id, key_prefix, secret_hash)
        VALUES (${user!.id}, ${keyPrefix(bootstrapKey)}, ${hashApiKey(bootstrapKey)})
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
    } finally {
      await knowledge.close();
    }
  });
}
