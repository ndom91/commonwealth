import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  commitFiles,
  ensureRepository,
  head,
  history,
  listConceptPaths,
  readFileAtCommit,
} from './corpus.js';

test('initializes, commits, and reads a workspace OKF bundle', async () => {
  const corpusPath = await mkdtemp(join(tmpdir(), 'commonwealth-corpus-test-'));
  try {
    const repository = await ensureRepository(corpusPath, 'core-team');
    const commit = await commitFiles({
      actor: 'human:test',
      corpusPath,
      files: [
        {
          path: 'playbooks/deploy.md',
          text: '---\ntype: Playbook\ntitle: Deploy\n---\n\n# Deploy\n',
        },
      ],
      subject: 'Create playbooks/deploy.md',
      workspace: 'core-team',
    });

    assert.match(repository, /core-team$/);
    assert.match(commit, /^[0-9a-f]{40}$/);
    assert.equal(await head(corpusPath, 'core-team'), commit);
    assert.deepEqual(await listConceptPaths(corpusPath, 'core-team'), ['playbooks/deploy.md']);
    const entries = await history(corpusPath, 'core-team', 'playbooks/deploy.md');
    assert.equal(entries[0]?.commit, commit);
    assert.equal(entries[0]?.subject, 'Create playbooks/deploy.md');
    assert.equal(
      await readFileAtCommit(corpusPath, 'core-team', 'playbooks/deploy.md'),
      '---\ntype: Playbook\ntitle: Deploy\n---\n\n# Deploy\n'
    );
  } finally {
    await rm(corpusPath, { recursive: true, force: true });
  }
});

test('refuses paths that can leave a workspace bundle', async () => {
  const corpusPath = await mkdtemp(join(tmpdir(), 'commonwealth-corpus-test-'));
  try {
    await assert.rejects(
      () =>
        commitFiles({
          actor: 'human:test',
          corpusPath,
          files: [{ path: '../escape.md', text: '---\ntype: Reference\n---\n' }],
          subject: 'Escape',
          workspace: 'core-team',
        }),
      /path is invalid/
    );
  } finally {
    await rm(corpusPath, { recursive: true, force: true });
  }
});
