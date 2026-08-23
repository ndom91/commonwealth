import { history, readFileAtCommit } from '@commonwealth/corpus';
import { type SearchProjectInput, searchProject } from '@commonwealth/corpus/search';
import { parseOkfDocument } from '@commonwealth/pipeline';

const AUTHORITIES = ['unverified', 'approved', 'canonical'] as const;
type Authority = (typeof AUTHORITIES)[number];

function authority(frontmatter: Record<string, unknown>): Authority {
  const commonwealth = frontmatter.commonwealth;
  if (commonwealth === null || typeof commonwealth !== 'object') return 'unverified';
  const value = (commonwealth as Record<string, unknown>).authority;
  return AUTHORITIES.includes(value as Authority) ? (value as Authority) : 'unverified';
}

function tags(frontmatter: Record<string, unknown>): string[] {
  return Array.isArray(frontmatter.tags)
    ? [...new Set(frontmatter.tags.map((tag) => String(tag).trim()).filter(Boolean))]
    : [];
}

function title(frontmatter: Record<string, unknown>): string | null {
  return typeof frontmatter.title === 'string' && frontmatter.title.trim()
    ? frontmatter.title.trim()
    : null;
}

function revisionTime(frontmatter: Record<string, unknown>): string | null {
  const verified = frontmatter.verified;
  if (!Array.isArray(verified)) return null;
  const latest = verified.at(-1);
  if (latest === null || typeof latest !== 'object') return null;
  const at = (latest as Record<string, unknown>).at;
  return typeof at === 'string' ? at : null;
}

export async function conceptVersion(input: {
  commit: string;
  corpusPath: string;
  path: string;
  project: string;
}) {
  const entries = await history(input.corpusPath, input.project, input.path);
  if (!entries.some((entry) => entry.commit === input.commit)) {
    throw new Error('That commit is not in this concept history');
  }

  const markdown = await readFileAtCommit(
    input.corpusPath,
    input.project,
    input.path,
    input.commit
  );
  const document = parseOkfDocument(markdown);
  return {
    authority: authority(document.frontmatter),
    commit: input.commit,
    last_verified_at: revisionTime(document.frontmatter),
    markdown,
    tags: tags(document.frontmatter),
    title: title(document.frontmatter),
    type: document.frontmatter.type as string,
  };
}

export function inspectProject(input: SearchProjectInput) {
  return searchProject(input);
}
