import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSearchResult } from '../src/knowledge-repository.js';

const row = {
  source_id: 'source-1',
  revision_number: 2,
  title: 'Billing API',
  source_type: 'note',
  authority: 'canonical',
  author: 'Ada',
  author_id: 'user-1',
  heading: 'Invoices',
  content: 'Invoices expose the billing error code.',
  content_updated_at: '2026-07-24T00:00:00.000Z',
  semantic_score: 0.82,
  keyword_score: 0.47,
  authority_boost: 0.06,
  freshness_boost: 0.02,
  final_score: 0.79,
};

test('search results omit ranking internals unless requested', () => {
  const result = formatSearchResult(row, false);

  assert.equal(result.sourceId, 'source-1');
  assert.equal('scores' in result, false);
  assert.equal('explanation' in result, false);
});

test('search explanations expose only ranking signals', () => {
  const result = formatSearchResult(row, true);

  assert.deepEqual(result.scores, {
    semanticScore: 0.82,
    keywordScore: 0.47,
    authorityBoost: 0.06,
    freshnessBoost: 0.02,
    finalScore: 0.79,
  });
  assert.equal(
    result.explanation,
    'semantic match; exact keyword match; canonical source; recently updated'
  );
});
