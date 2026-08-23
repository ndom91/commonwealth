import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { validateOkfPath } from '@commonwealth/pipeline';

const execute = promisify(execFile);
const locks = new Map<string, Promise<void>>();

export type CommitFile = {
  path: string;
  text: string;
};

export type CommitInput = {
  actor: string;
  corpusPath: string;
  files: CommitFile[];
  subject: string;
  workspace: string;
};

export type HistoryEntry = {
  commit: string;
  subject: string;
  timestamp: string;
};

// commitFiles writes concept files in an isolated worktree and advances the workspace main branch.
export async function commitFiles(input: CommitInput): Promise<string> {
  const repository = repositoryPath(input.corpusPath, input.workspace);

  return withLock(repository, async () => {
    await ensureRepository(input.corpusPath, input.workspace);
    const worktree = await mkdtemp(join(tmpdir(), 'commonwealth-corpus-'));
    try {
      await git(repository, ['worktree', 'add', '--detach', worktree, 'main']);
      for (const file of input.files) {
        const path = validateOkfPath(file.path);
        const target = within(worktree, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.text, 'utf8');
      }
      await git(worktree, ['add', '--', ...input.files.map((file) => validateOkfPath(file.path))]);
      await git(worktree, [
        'commit',
        '--no-gpg-sign',
        '-m',
        input.subject,
        '-m',
        `Commonwealth-Actor: ${input.actor}`,
      ]);
      const commit = (await git(worktree, ['rev-parse', 'HEAD'])).trim();
      const previous = (await git(worktree, ['rev-parse', 'HEAD^'])).trim();
      await git(repository, ['update-ref', 'refs/heads/main', commit, previous]);

      return commit;
    } finally {
      await git(repository, ['worktree', 'remove', '--force', worktree]).catch(() => undefined);
      await rm(worktree, { recursive: true, force: true });
    }
  });
}

// ensureRepository initializes a workspace's local OKF Git repository when it does not exist.
export async function ensureRepository(corpusPath: string, workspace: string): Promise<string> {
  const repository = repositoryPath(corpusPath, workspace);
  try {
    await git(repository, ['rev-parse', '--git-dir']);

    return repository;
  } catch {
    await mkdir(corpusPath, { recursive: true });
    await git(corpusPath, ['init', '--initial-branch=main', repository]);
    await git(repository, ['config', 'user.name', 'Commonwealth']);
    await git(repository, ['config', 'user.email', 'commonwealth@localhost']);
    await writeFile(
      join(repository, 'index.md'),
      '---\nokf_version: "0.2"\n---\n\n# Knowledge\n',
      'utf8'
    );
    await git(repository, ['add', 'index.md']);
    await git(repository, ['commit', '--no-gpg-sign', '-m', 'Initialize OKF bundle']);

    return repository;
  }
}

// head returns the current main commit for a workspace bundle.
export async function head(corpusPath: string, workspace: string): Promise<string> {
  const repository = await ensureRepository(corpusPath, workspace);

  return (await git(repository, ['rev-parse', 'main'])).trim();
}

// history returns commits that changed a concept, newest first.
export async function history(
  corpusPath: string,
  workspace: string,
  path: string
): Promise<HistoryEntry[]> {
  const repository = await ensureRepository(corpusPath, workspace);
  const safePath = validateOkfPath(path);
  const output = await git(repository, ['log', '--format=%H%x09%aI%x09%s', '--', safePath]);
  const entries: HistoryEntry[] = [];
  for (const line of output.trim().split('\n')) {
    if (!line) continue;
    const [commit, timestamp, subject] = line.split('\t');
    if (!commit || !timestamp || subject === undefined) continue;
    entries.push({ commit, timestamp, subject });
  }

  return entries;
}

// commitInfo returns the recorded metadata for one commit, including a workspace
// snapshot that may not have directly changed the source being viewed.
export async function commitInfo(
  corpusPath: string,
  workspace: string,
  commit: string
): Promise<HistoryEntry> {
  const repository = await ensureRepository(corpusPath, workspace);
  const output = (await git(repository, ['show', '-s', '--format=%H%x09%aI%x09%s', commit])).trim();
  const [id, timestamp, subject] = output.split('\t');
  if (!id || !timestamp || subject === undefined) throw new Error('Git commit could not be read');
  return { commit: id, timestamp, subject };
}

// listConceptPaths returns every non-reserved Markdown concept at a commit.
export async function listConceptPaths(
  corpusPath: string,
  workspace: string,
  commit = 'main'
): Promise<string[]> {
  const repository = await ensureRepository(corpusPath, workspace);
  const output = await git(repository, ['ls-tree', '-r', '--name-only', commit]);
  const paths: string[] = [];
  for (const path of output.split('\n')) {
    if (!path.endsWith('.md')) continue;
    const name = basename(path);
    if (name === 'index.md' || name === 'log.md') continue;
    paths.push(validateOkfPath(path));
  }

  return paths;
}

// readFileAtCommit reads an exact concept version from a workspace repository.
export async function readFileAtCommit(
  corpusPath: string,
  workspace: string,
  path: string,
  commit = 'main'
): Promise<string> {
  const repository = await ensureRepository(corpusPath, workspace);
  const safePath = validateOkfPath(path);

  return git(repository, ['show', `${commit}:${safePath}`]);
}

function git(cwd: string, args: string[]): Promise<string> {
  return execute('git', args, { cwd, encoding: 'utf8' }).then(({ stdout }) => stdout);
}

function repositoryPath(corpusPath: string, workspace: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(workspace)) {
    throw new Error('Workspace slug is invalid');
  }

  return join(resolve(corpusPath), workspace);
}

function within(root: string, path: string): string {
  const target = resolve(root, path);
  if (dirname(target) !== root && !dirname(target).startsWith(`${root}/`)) {
    throw new Error('OKF concept path escapes the workspace');
  }

  return target;
}

async function withLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  locks.set(key, queued);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (locks.get(key) === queued) locks.delete(key);
  }
}
