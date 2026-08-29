/* Slugs are the URL segment, so they are shape-checked before reaching SQL and
   the same expression validates one on the way in at `createProject`. */
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/* The payload shape of a scoped server function, and the validator for one that
   takes nothing else. Both live here because they are safe to import from
   client-free input parsers as well as server functions. */
export type Scoped<T> = T & { project: string };

export function validateProject(value: unknown): string {
  const slug = (value as { project?: string } | undefined)?.project?.trim();
  if (!slug || !SLUG.test(slug)) throw new Error('Invalid project');
  return slug;
}

export function validateScope(value: unknown): { project: string } {
  return { project: validateProject(value) };
}
