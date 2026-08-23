/* What the browser tab says.
 *
 * Three facts, narrowest first: which page, which corpus, which product. A tab
 * strip truncates from the right, so the page — the only part that differs
 * between two tabs of the same project — has to be the part that survives.
 *
 * The separators are doing work and are not interchangeable. The middle dot
 * joins two things about the same instance; the em dash steps down to the
 * product name, matching the plate, where the project is the heading and
 * "Commonwealth" is the sub-line. `chrome.tsx` explains why that order: with
 * more than one project, which one you are looking at outranks what the
 * product is called.
 *
 * Not used by the signed-out routes. Sign-in, an invitation and the project
 * picker fall through to the bare product name in `__root.tsx`, because naming
 * a project to someone who has not authenticated would state an instance fact
 * before there is anyone to state it to. */
export function documentTitle(page: string, project: string): string {
  return `${page} · ${project} — Commonwealth`;
}

/* A project with no page named yet — the layout's own title, inherited by any
   route under it that does not set one. Keeping it here rather than inline in
   `w/$slug.tsx` means the two halves cannot drift into different separators. */
export function projectTitle(project: string): string {
  return `${project} — Commonwealth`;
}
