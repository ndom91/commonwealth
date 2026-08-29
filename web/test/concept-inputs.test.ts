import assert from 'node:assert/strict';
import test from 'node:test';
import {
  optionalAuthority,
  optionalFilters,
  optionalText,
  pathInput,
  retrievalInput,
  tags,
  versionInput,
} from '../src/lib/concept-inputs.js';

test('validates scoped concept paths and revisions', () => {
  assert.deepEqual(pathInput({ project: 'core-team', path: 'playbooks/deploy.md' }), {
    project: 'core-team',
    path: 'playbooks/deploy.md',
  });
  assert.deepEqual(
    versionInput({
      project: 'core-team',
      path: 'playbooks/deploy.md',
      commit: 'a'.repeat(40),
    }),
    { project: 'core-team', path: 'playbooks/deploy.md', commit: 'a'.repeat(40) }
  );
  assert.throws(() => pathInput({ project: 'core-team', path: '../secret.md' }), /path is invalid/);
  assert.throws(
    () => pathInput({ project: 'invalid slug', path: 'playbooks/deploy.md' }),
    /project/
  );
  assert.throws(
    () => versionInput({ project: 'core-team', path: 'playbooks/deploy.md', commit: 'short' }),
    /commit/
  );
});

test('normalizes optional concept filters without accepting invalid values', () => {
  assert.equal(optionalAuthority(undefined), null);
  assert.equal(optionalAuthority('canonical'), 'canonical');
  assert.throws(() => optionalAuthority('trusted'), /authority/);
  assert.equal(optionalText('  Playbook  ', 'type'), 'Playbook');
  assert.equal(optionalText('', 'type'), null);
  assert.throws(() => optionalText('   ', 'type'), /type/);
  assert.deepEqual(
    optionalFilters({ project: 'core-team', authority: 'approved', type: ' Runbook ' }),
    {
      project: 'core-team',
      authority: 'approved',
      type: 'Runbook',
    }
  );
});

test('keeps creation tags permissive but retrieval tags strict', () => {
  assert.deepEqual(tags([' ops ', 'ops', 42, '', null]), ['ops', '42', 'null']);
  assert.deepEqual(
    retrievalInput({
      project: 'core-team',
      query: ' restart worker ',
      limit: 5,
      tags: ['operations', 'runbooks'],
      authority: 'approved',
      type: ' Playbook ',
    }),
    {
      project: 'core-team',
      authority: 'approved',
      limit: 5,
      query: 'restart worker',
      tags: ['operations', 'runbooks'],
      type: 'Playbook',
    }
  );
  assert.throws(
    () => retrievalInput({ project: 'core-team', query: 'restart', limit: 0 }),
    /result limit/
  );
  assert.throws(
    () => retrievalInput({ project: 'core-team', query: 'restart', limit: 5, tags: [''] }),
    /tags/
  );
  assert.throws(
    () => retrievalInput({ project: 'core-team', query: 'restart', limit: 5, tags: 'ops' }),
    /tags/
  );
});
