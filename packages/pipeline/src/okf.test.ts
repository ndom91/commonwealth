import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOkfDocument, serializeOkfDocument, validateOkfPath } from './okf.js';

test('parses an OKF concept and preserves unknown frontmatter', () => {
  const parsed = parseOkfDocument(
    '---\ntype: Playbook\ntitle: Deploy\ncustom:\n  retained: true\n---\n# Deploy\n\nRun it.\n'
  );

  assert.equal(parsed.frontmatter.type, 'Playbook');
  assert.deepEqual(parsed.frontmatter.custom, { retained: true });
  assert.equal(parsed.body, '# Deploy\n\nRun it.\n');
});

test('rejects malformed or incomplete OKF frontmatter', () => {
  assert.throws(() => parseOkfDocument('# No frontmatter'), /must begin/);
  assert.throws(() => parseOkfDocument('---\ntitle: Missing type\n---\nbody'), /non-empty type/);
  assert.throws(() => parseOkfDocument('---\ntype: [\n---\nbody'), /Invalid OKF YAML/);
});

test('serializes a parseable canonical concept', () => {
  const text = serializeOkfDocument({
    frontmatter: { type: 'Reference', tags: ['docs'] },
    body: '# Reference\n',
  });

  assert.deepEqual(parseOkfDocument(text), {
    frontmatter: { type: 'Reference', tags: ['docs'] },
    body: '# Reference\n',
  });
});

test('only accepts safe non-reserved concept paths', () => {
  assert.equal(validateOkfPath('playbooks/incident.md'), 'playbooks/incident.md');
  for (const path of [
    'index.md',
    'notes/../secret.md',
    '/absolute.md',
    'notes\\secret.md',
    'notes/a',
  ]) {
    assert.throws(() => validateOkfPath(path));
  }
});
