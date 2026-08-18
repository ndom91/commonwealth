/* The bench ships two schemes and a way to pin one.
 *
 * Pure on purpose: this module is imported by the browser (the rail's toggle) and
 * by the server (which reads the pin before the document is sent), so it may not
 * reach for the framework or the database. Reading and writing the cookie itself
 * belongs to the framework's `getCookie`/`setCookie`, and the two server functions
 * that call them live in `session.ts` beside the other shell context.
 *
 * Absent is not dark. A reader who has never touched the toggle has *not* chosen
 * dark — they have chosen nothing, and `color-scheme: light dark` defers to their
 * operating system. That distinction is why every function here returns
 * `undefined` rather than falling back to a scheme. */

// DEFAULT_THEME is the scheme the bench ships, and what a surface assumes before
// it can ask the browser which one is actually in force.
export const DEFAULT_THEME: Theme = 'dark';

// THEME_COOKIE is the cookie the rail's toggle writes, readable by both sides.
export const THEME_COOKIE = 'cw_theme';

// A year. The pin is a preference, not a session, and outliving the session is
// the whole point — signing back in should not lose it.
export const THEME_MAX_AGE = 60 * 60 * 24 * 365;

// Theme is a pinned colour scheme. Its absence means the operating system decides.
export type Theme = 'dark' | 'light';

// other returns the scheme a toggle would move to from the one given.
export function other(theme: Theme): Theme {
  if (theme === 'dark') {
    return 'light';
  }

  return 'dark';
}

// parseTheme returns the named scheme, or undefined when the value names neither
// — an unrecognised pin is treated as no pin rather than as a default.
export function parseTheme(value: string | undefined): Theme | undefined {
  if (value === 'dark') {
    return 'dark';
  }
  if (value === 'light') {
    return 'light';
  }

  return undefined;
}
