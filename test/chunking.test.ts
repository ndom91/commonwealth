import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkMarkdown } from '@commonwealth/pipeline';

test('chunks Markdown by section while retaining headings', () => {
  const chunks = chunkMarkdown(
    '# Product\n\nThe product is documented here.\n\n## Billing\n\nBilling uses invoices.'
  );

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]?.heading, 'Product');
  assert.equal(chunks[1]?.heading, 'Billing');
  assert.match(chunks[1]?.content ?? '', /Billing uses invoices/);
});
