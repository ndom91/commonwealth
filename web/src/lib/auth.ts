import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAccessControl } from 'better-auth/plugins/access';
import { organization } from 'better-auth/plugins/organization';
import { tanstackStartCookies } from 'better-auth/tanstack-start';
import * as schema from '../db/schema.js';
import { db } from './db.js';

/* The organization plugin, pointed at the project table the knowledge side
 * already scopes everything to rather than a duplicate of it. `concepts`,
 * `concept_chunks`, `users`, `events` and `index_configuration` all carry
 * `project_id`, and
 * `mcp-server/src/access-service.ts` already scopes every MCP request by it — agents have
 * been multi-tenant all along. This makes people multi-tenant on the same axis.
 *
 * The plugin's own statements (`organization`, `member`, `invitation`, `team`,
 * `ac`) govern *its* endpoints. Our enforcement does not go through them: every
 * server function calls `requireMember(permission)` in `session.ts`, which
 * reads the member row and applies `roles.ts`. Keeping authorisation in one
 * legible place matters more than reusing the plugin's `hasPermission`.
 *
 * What the plugin is here for is the membership table, the role column, and
 * `session.activeOrganizationId` — the project switching that wave B needs,
 * including persisting the choice across requests. */
const ac = createAccessControl({
  organization: ['update', 'delete'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
});

const roles = {
  reader: ac.newRole({}),
  writer: ac.newRole({}),
  reviewer: ac.newRole({}),
  admin: ac.newRole({
    organization: ['update'],
    member: ['create', 'update', 'delete'],
    invitation: ['create', 'cancel'],
  }),
};

const membership = () =>
  organization({
    ac,
    roles,
    /* Not `owner`, which is the default and would be a fifth role nobody else
       uses. See `roles.ts`. */
    creatorRole: 'admin',
    /* Project creation is our transaction in `management.ts`: it also creates
        membership and index configuration. Keep better-auth's narrower endpoint
        closed so it cannot create an incomplete project. */
    allowUserToCreateOrganization: false,
    schema: {
      organization: {
        modelName: 'projects',
        fields: { createdAt: 'created_at' },
      },
      member: {
        fields: { organizationId: 'project_id', userId: 'user_id', createdAt: 'created_at' },
      },
      invitation: {
        fields: {
          organizationId: 'project_id',
          inviterId: 'inviter_id',
          expiresAt: 'expires_at',
          createdAt: 'created_at',
        },
      },
    },
  });

const forwardedIpHeaders: string[] = [];
if (process.env.TRUST_FORWARDED_FOR === 'true') {
  const configuredHeader = process.env.FORWARDED_IP_HEADER?.trim();
  if (configuredHeader) {
    forwardedIpHeaders.push(configuredHeader);
  } else {
    forwardedIpHeaders.push('x-forwarded-for');
  }
}

const trustedOrigins = ['http://localhost:3001', 'http://127.0.0.1:3001'];
const authUrl = process.env.BETTER_AUTH_URL?.trim();
if (authUrl) trustedOrigins.push(authUrl);

const shared = {
  baseURL: authUrl,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins,
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  /* Covers better-auth's own endpoints only — `/api/auth/*`. Our server
   * functions are a separate surface with a separate limiter; see
   * `management.ts` for the invitation routes, which are the unauthenticated
   * ones.
   *
   * `enabled` is set rather than left alone because better-auth turns the
   * limiter *off* outside production, and a limiter that never runs in
   * development is one that breaks unnoticed. The global allowance is set well
   * above what clicking around the admin costs, so ordinary work never meets
   * it; the rule that actually bites is the one on sign-in.
   *
   * Memory storage, the default, matching the limiters on our own endpoints:
   * counters are lost on restart and are per-process. That is the accepted
   * trade for a single-container deployment, and the thing to revisit first if
   * this ever runs more than one.
   *
   * Harmless on `provisioning`, which shares this object: better-auth exempts
   * server-side `auth.api` calls from the limiter entirely, and that instance
   * is only ever reached that way.
   *
   * The shipped compose binds the admin to loopback with no proxy, so address
   * tracking is disabled until the operator explicitly trusts a proxy. That
   * proxy must protect the service from direct access before it can safely pass
   * `X-Forwarded-For` or Cloudflare's `CF-Connecting-IP`. */
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      /* better-auth's own default for this path, stated here so it survives a
         change to the global numbers above. Password guessing is the one thing
         on this surface worth making slow. */
      '/sign-in/email': { window: 10, max: 3 },
    },
  },
  /* `projects.id` is `uuid` and predates better-auth, so ids the plugin
     generates for it have to be uuids. Safe for the tables better-auth already
     owns: `user`, `session`, `account` and `verification` all key on `text`, so
     existing rows keep the ids they have and only new ones change shape.
   *
     A function rather than the built-in `'uuid'`, which does not mean "generate
     a uuid in JS" — it means "let the database do it", and none of the
     better-auth tables have a default on `id`. Using it makes every sign-up
     fail with `Failed to create user` on a not-null violation.
   *
     Web Crypto rather than `node:crypto`. This module is reachable from the
     client module graph — routes import `getViewer` from `session.ts`, which
     imports this — and a `node:` builtin here pulls a shim that throws
     `Buffer is not defined` at import time, which kills hydration for the whole
     application. The page still renders, so the only symptom is that nothing
     responds to a click. */
  advanced: {
    database: { generateId: () => globalThis.crypto.randomUUID() },
    ipAddress: { ipAddressHeaders: forwardedIpHeaders },
  },
};

/* The instance every request goes through. Sign-up is closed unless the
   operator opts in, which is the product's stated security posture. */
export const auth = betterAuth({
  ...shared,
  emailAndPassword: {
    enabled: true,
    disableSignUp: process.env.BETTER_AUTH_ALLOW_SIGN_UP !== 'true',
  },
  /* One page is several server functions, each its own HTTP request, and each
   * one asks who is signed in. Nothing request-scoped can span them, so without
   * this the People page cost six `session`⋈`user` reads before doing any work
   * of its own. Measured on this instance: twenty queries a load before, eight
   * after, with the session reads going to nought.
   *
   * Nought in the steady state, not always. The four server functions of a page
   * load go out in parallel, so on the load *after* the cookie expires they all
   * miss together and all read — four, once a minute, rather than six every
   * time. Coalescing them would need a request-level lock for a saving that
   * small, so it is left alone; the number to expect is "nought, occasionally
   * four", not "one".
   *
   * **What this can and cannot make stale is the whole argument.** Roles and
   * membership are *not* in the cookie: `readMembership` reads the `member`
   * table on every call and never consults the session for anything but an id,
   * so demoting someone, or removing them from a project, takes effect on
   * their very next request — verified by demoting mid-session and watching the
   * next call refuse. What lags is session revocation: signing out on another
   * device, or the row going away, stays usable until the cookie expires. Also
   * verified — a deleted session answered for another ~60 seconds and then
   * stopped.
   *
   * Sixty seconds rather than the five minutes better-auth's example uses,
   * because that lag is the entire cost of this and a minute is short enough
   * not to matter. `disableCookieCache` is available per call if something ever
   * needs the database answer.
   *
   * On this instance only, not `shared`: `provisioning` mints no session, so it
   * has nothing to cache. */
  session: { cookieCache: { enabled: true, maxAge: 60 } },
  plugins: [membership(), tanstackStartCookies()],
});

/* Redeeming an invitation needs sign-up permitted, and `disableSignUp` is
 * enforced inside the sign-up handler itself — so `auth.api.signUpEmail` on the
 * instance above throws `EMAIL_PASSWORD_SIGN_UP_DISABLED` regardless of being
 * called server-side. `web/scripts/migrate.ts` hits the same wall and solves
 * it by forcing the env flag for its own process; a long-lived server cannot,
 * because the flag is read once at import and would then be open for everyone.
 *
 * So provisioning gets its own instance over the same database: sign-up
 * enabled, reachable only from `acceptInvitation`, which is gated on a valid
 * single-use token. The public HTTP surface still refuses sign-up.
 *
 * Two deliberate differences from the instance above:
 *
 * - **No `tanstackStartCookies`.** That plugin writes any `set-cookie` the auth
 *   API emits onto the current response, so creating an account would replace
 *   the acting administrator's session with the new user's.
 * - **`autoSignIn: false`.** Belt and braces for the same thing, and it avoids
 *   minting a session row nobody will ever use. It also makes better-auth
 *   answer a duplicate email generically, which is why `acceptInvitation`
 *   checks for an existing account before calling this. */
export const provisioning = betterAuth({
  ...shared,
  emailAndPassword: { enabled: true, disableSignUp: false, autoSignIn: false },
  plugins: [membership()],
});
