import { validateOkfPath } from '@commonwealth/pipeline';
import { type Scoped, validateProject } from './authorize.js';

const AUTHORITIES = ['unverified', 'approved', 'canonical'] as const;
export type Authority = (typeof AUTHORITIES)[number];

export function corpusPath(): string {
  return process.env.CORPUS_PATH?.trim() || '/app/corpora';
}

export function optionalAuthority(value: unknown): Authority | null {
  if (value === undefined || value === null || value === '') return null;
  if (!AUTHORITIES.includes(value as Authority)) throw new Error('Invalid authority');
  return value as Authority;
}

export function optionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${field}`);
  return value.trim();
}

export function tags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((tag) => String(tag).trim()).filter(Boolean))];
}

export function actorName(userId: string): string {
  return `admin/${userId}`;
}

export function pathInput(value: unknown): Scoped<{ path: string }> {
  return { project: validateProject(value), path: requiredPath(value) };
}

export function requiredPath(value: unknown): string {
  const path = (value as { path?: string })?.path;
  if (typeof path !== 'string') throw new Error('Invalid concept path');
  return validateOkfPath(path);
}

export function optionalFilters(
  value: unknown
): Scoped<{ authority: Authority | null; type: string | null }> {
  const input = (value ?? {}) as Record<string, unknown>;
  return {
    project: validateProject(value),
    authority: optionalAuthority(input.authority),
    type: optionalText(input.type, 'type'),
  };
}

export function versionInput(value: unknown): Scoped<{ commit: string; path: string }> {
  const input = value as { commit?: string };
  const commit = input?.commit;
  if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error('Invalid concept commit');
  }

  return { ...pathInput(value), commit };
}

export function retrievalInput(value: unknown): Scoped<{
  authority: Authority | null;
  limit: number;
  query: string;
  tags: string[];
  type: string | null;
}> {
  const input = (value ?? {}) as Record<string, unknown>;
  const query = optionalText(input.query, 'search');
  if (!query) throw new Error('Invalid search');
  if (
    !Number.isInteger(input.limit) ||
    (input.limit as number) < 1 ||
    (input.limit as number) > 20
  ) {
    throw new Error('Invalid result limit');
  }
  if (input.tags !== undefined && !Array.isArray(input.tags)) throw new Error('Invalid tags');
  const selectedTags = input.tags ?? [];
  if (!selectedTags.every((tag) => typeof tag === 'string' && tag.trim().length > 0)) {
    throw new Error('Invalid tags');
  }

  return {
    project: validateProject(value),
    authority: optionalAuthority(input.authority),
    limit: input.limit as number,
    query,
    tags: selectedTags.map((tag) => tag.trim()),
    type: optionalText(input.type, 'type'),
  };
}
