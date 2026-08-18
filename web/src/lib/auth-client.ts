import { createAuthClient } from 'better-auth/react';

/* No `fetchOptions.onError` here, and not for want of trying.
 *
 * The obvious place to improve a throttled response — reading `X-Retry-After`
 * off the 429 and saying how many seconds to wait — does not work. better-fetch
 * builds the `error` it hands to `onError` as one spread of the parsed body,
 * and then builds the `error` it *returns* as a second, separate spread after
 * the hooks have run (`@better-fetch/fetch`, `betterFetch`, near the end).
 * Mutating the first has no effect on the second, so a message written in
 * `onError` is silently discarded and the call site shows the original.
 *
 * `result.error.status` does survive, so a call site can branch on 429 — but it
 * cannot see the header, and hardcoding "wait 10 seconds" would be a number
 * that quietly becomes wrong the moment the rule in `auth.ts` changes.
 *
 * better-auth's own body is "Too many requests. Please try again later.", which
 * the sign-in page already surfaces through `result.error.message`. True, and
 * missing only a figure we cannot reach. That is the better trade. */
export const authClient = createAuthClient({ baseURL: process.env.BETTER_AUTH_URL });
