/* What the browser tab says.
 *
 * Three facts, narrowest first: which page, which corpus, which product. A tab
 * strip truncates from the right, so the page — the only part that differs
 * between two tabs of the same workspace — has to be the part that survives.
 *
 * The separators are doing work and are not interchangeable. The middle dot
 * joins two things about the same instance; the em dash steps down to the
 * product name, matching the plate, where the workspace is the heading and
 * "Commonwealth" is the sub-line. `chrome.tsx` explains why that order: with
 * more than one workspace, which one you are looking at outranks what the
 * product is called.
 *
 * Not used by the signed-out routes. Sign-in, an invitation and the workspace
 * picker fall through to the bare product name in `__root.tsx`, because naming
 * a workspace to someone who has not authenticated would state an instance fact
 * before there is anyone to state it to. */
export function documentTitle(page: string, workspace: string): string {
  return `${page} · ${workspace} — Commonwealth`;
}

/* A workspace with no page named yet — the layout's own title, inherited by any
   route under it that does not set one. Keeping it here rather than inline in
   `w/$slug.tsx` means the two halves cannot drift into different separators. */
export function workspaceTitle(workspace: string): string {
  return `${workspace} — Commonwealth`;
}
