import { parseDocument, stringify } from 'yaml';

const RESERVED_NAMES = new Set(['index.md', 'log.md']);

export type OkfDocument = {
  body: string;
  frontmatter: Record<string, unknown>;
};

export const OKF_AUTHORITIES = ['unverified', 'approved', 'canonical'] as const;
export type OkfAuthority = (typeof OKF_AUTHORITIES)[number];

export type OkfMetadata = {
  authority: OkfAuthority;
  description: string | null;
  generatedAt: string | null;
  generatedBy: string | null;
  lastVerifiedAt: string | null;
  status: 'deprecated' | 'draft' | 'stable';
  tags: string[];
  title: string | null;
  type: string;
};

// parseOkfDocument validates and parses one OKF concept document.
export function parseOkfDocument(text: string): OkfDocument {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) throw new Error('OKF concept must begin with YAML frontmatter');

  const yaml = match[1];
  if (yaml === undefined) throw new Error('OKF concept has no YAML frontmatter');
  const document = parseDocument(yaml, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(
      `Invalid OKF YAML frontmatter: ${document.errors[0]?.message ?? 'unknown error'}`
    );
  }
  const value = document.toJS();
  if (!isObject(value)) throw new Error('OKF frontmatter must be a mapping');
  if (typeof value.type !== 'string' || !value.type.trim()) {
    throw new Error('OKF frontmatter requires a non-empty type');
  }

  return { body: text.slice(match[0].length), frontmatter: value };
}

export function okfMetadata(frontmatter: Record<string, unknown>): OkfMetadata {
  const status = frontmatter.status;
  if (
    status !== undefined &&
    status !== 'draft' &&
    status !== 'stable' &&
    status !== 'deprecated'
  ) {
    throw new Error('OKF status must be draft, stable, or deprecated');
  }
  const tags = frontmatter.tags;
  if (tags !== undefined && (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string'))) {
    throw new Error('OKF tags must be an array of strings');
  }
  const commonwealth = objectOf(frontmatter.commonwealth);
  const authority = commonwealth.authority;
  const generated = objectOf(frontmatter.generated);
  const verified = frontmatter.verified;
  const latestVerification = Array.isArray(verified) ? objectOf(verified.at(-1)) : {};

  return {
    authority: OKF_AUTHORITIES.includes(authority as OkfAuthority)
      ? (authority as OkfAuthority)
      : 'unverified',
    description: stringOf(frontmatter.description),
    generatedAt: stringOf(generated.at),
    generatedBy: stringOf(generated.by),
    lastVerifiedAt: stringOf(latestVerification.at),
    status: status ?? 'stable',
    tags: tags ?? [],
    title: stringOf(frontmatter.title),
    type: frontmatter.type as string,
  };
}

// serializeOkfDocument returns a canonical UTF-8 OKF concept document.
export function serializeOkfDocument(document: OkfDocument): string {
  if (!isObject(document.frontmatter)) throw new Error('OKF frontmatter must be a mapping');
  if (typeof document.frontmatter.type !== 'string' || !document.frontmatter.type.trim()) {
    throw new Error('OKF frontmatter requires a non-empty type');
  }

  const yaml = stringify(document.frontmatter).trimEnd();

  return `---\n${yaml}\n---\n${document.body}`;
}

// validateOkfPath returns a normalized safe bundle-relative concept path.
export function validateOkfPath(path: string): string {
  if (!path.endsWith('.md')) throw new Error('OKF concept path must end in .md');
  if (path.includes('\\') || path.includes('\0')) throw new Error('OKF concept path is invalid');

  const parts = path.split('/');
  if (parts.length === 0) throw new Error('OKF concept path is invalid');
  for (const part of parts) {
    if (!part || part === '.' || part === '..') throw new Error('OKF concept path is invalid');
  }
  const name = parts[parts.length - 1];
  if (!name || RESERVED_NAMES.has(name))
    throw new Error('OKF concept path uses a reserved filename');

  return path;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function objectOf(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
