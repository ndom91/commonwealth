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

test('nests heading paths so a subsection keeps its parent', () => {
  const chunks = chunkMarkdown(
    '# Deploy\n\n## Ports\n\nBind 3001.\n\n### TLS\n\nCaddy is optional.'
  );

  assert.deepEqual(chunks[0]?.headingPath, ['Deploy', 'Ports']);
  assert.deepEqual(chunks[1]?.headingPath, ['Deploy', 'Ports', 'TLS']);
  /* The leaf still populates `chunks.heading`, which is what search displays. */
  assert.equal(chunks[1]?.heading, 'TLS');
});

/* The regression this rewrite exists for. Splitting on whitespace and rejoining
   with a space turned this block into ```yaml services: admin: ports: -
   "3001:3001"``` on one line, and `content` is what `excerpt` quotes back. */
test('a fenced code block survives byte for byte', () => {
  const fence = '```yaml\nservices:\n  admin:\n    ports:\n      - "3001:3001"\n```';
  const chunks = chunkMarkdown(`## Ports\n\nSet them:\n\n${fence}\n`);

  assert.equal(chunks.length, 1);
  assert.ok(chunks[0]?.content.includes(fence));
});

test('a table keeps one row per line', () => {
  const table = '| Port | Use   |\n|------|-------|\n| 3001 | admin |';
  const chunks = chunkMarkdown(`## Ports\n\n${table}\n`);

  assert.ok(chunks[0]?.content.includes(table));
});

/* `^#{1,6}\s+` matches a shell comment, so the old splitter tore scripts in
   half and blamed the remainder on a heading that was really a comment. */
test('a comment inside a fence does not start a section', () => {
  const chunks = chunkMarkdown(
    '## Setup\n\n```bash\n# set the port\nexport PORT=3001\n# start it\npnpm dev\n```\n'
  );

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.heading, 'Setup');
  assert.ok(chunks[0]?.content.includes('# set the port'));
  assert.ok(chunks[0]?.content.includes('pnpm dev'));
});

test('a heading with no body prefixes its children instead of becoming a chunk', () => {
  const chunks = chunkMarkdown('# Deploy\n\n## Ports\n\nBind 3001.');

  assert.equal(chunks.length, 1);
  assert.deepEqual(chunks[0]?.headingPath, ['Deploy', 'Ports']);
  assert.equal(chunks[0]?.content, 'Bind 3001.');
});

test('a document of headings alone yields nothing to index', () => {
  assert.deepEqual(chunkMarkdown('# A\n\n## B\n\n### C\n'), []);
});

test('prose with no heading still chunks', () => {
  const chunks = chunkMarkdown('Just a paragraph.\n\nAnd another.');

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.heading, null);
  assert.deepEqual(chunks[0]?.headingPath, []);
});

test('long sections split under the cap and overlap by whole blocks', () => {
  const body = Array.from({ length: 40 }, (_, index) => `Para ${index} ${'word '.repeat(30)}`).join(
    '\n\n'
  );
  const chunks = chunkMarkdown(`## Big\n\n${body}`);

  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.tokenCount <= 500);
  const tail = chunks[0]?.content.split('\n\n').at(-1) ?? '';
  assert.ok(chunks[1]?.content.startsWith(tail), 'second chunk carries the first chunk’s tail');
});

/* Budget yields to correctness: half a code sample helps nobody. */
test('a single block over the cap is emitted whole', () => {
  const chunks = chunkMarkdown(`## Huge\n\n\`\`\`\n${'line\n'.repeat(700)}\`\`\`\n`);

  assert.equal(chunks.length, 1);
  assert.ok((chunks[0]?.tokenCount ?? 0) > 500);
  assert.ok(chunks[0]?.content.trimEnd().endsWith('```'));
});
