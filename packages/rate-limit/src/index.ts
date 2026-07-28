/* Request limiting, shared by the MCP server and the admin app.
 *
 * Both services need to refuse callers who ask too often, and they need to
 * agree on what "too often" means well enough that an operator reading one
 * `Retry-After` understands the other. Beyond that the two surfaces have
 * nothing in common — one is a bearer-token JSON-RPC endpoint, the other a set
 * of server functions behind a session — so this package holds only the
 * counting and the address decision, and each caller keeps its own policy,
 * its own keys, and its own way of saying no.
 *
 * Nothing here touches Postgres or reads the environment, for the same reason
 * `@commonwealth/pipeline` does not: the callers' configuration schemas differ
 * and neither should inherit the other's.
 *
 * `exports` points at TypeScript source rather than a build output, so there is
 * no compile step to sequence in either Dockerfile — see the note in
 * `@commonwealth/pipeline` for the consequence. Bare `node` cannot import this. */

export { clientIp, type HeaderReader } from './client-ip.js';
export { type Decision, FixedWindow, type FixedWindowOptions } from './fixed-window.js';
