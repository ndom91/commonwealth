import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAccessControl } from 'better-auth/plugins/access';
import { organization } from 'better-auth/plugins/organization';
import { tanstackStartCookies } from 'better-auth/tanstack-start';
import * as schema from '../db/schema.js';
import { db } from './db.js';

/* The organization plugin, pointed at the workspace table the knowledge side
 * already scopes everything to rather than a duplicate of it. `sources`,
 * `users`, `events` and `index_configuration` all carry `workspace_id`, and
 * `src/access-service.ts` already scopes every MCP request by it — agents have
 * been multi-tenant all along. This makes people multi-tenant on the same axis.
 *
 * The plugin's own statements (`organization`, `member`, `invitation`, `team`,
 * `ac`) govern *its* endpoints. Our enforcement does not go through them: every
 * server function calls `requireMember(permission)` in `session.ts`, which
 * reads the member row and applies `roles.ts`. Keeping authorisation in one
 * legible place matters more than reusing the plugin's `hasPermission`.
 *
 * What the plugin is here for is the membership table, the role column, and
 * `session.activeOrganizationId` — the workspace switching that wave B needs,
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
    /* Wave A runs on the single existing workspace. Creating more is wave B,
       and until then this closes `POST /api/auth/organization/create` to
       everyone rather than leaving it open because nothing links to it. */
    allowUserToCreateOrganization: false,
    schema: {
      organization: {
        modelName: 'workspaces',
        fields: { createdAt: 'created_at' },
      },
      member: {
        fields: { organizationId: 'workspace_id', userId: 'user_id', createdAt: 'created_at' },
      },
      invitation: {
        fields: {
          organizationId: 'workspace_id',
          inviterId: 'inviter_id',
          expiresAt: 'expires_at',
          createdAt: 'created_at',
        },
      },
    },
  });

const shared = {
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: ['http://localhost:3001', 'http://127.0.0.1:3001'],
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  /* `workspaces.id` is `uuid` and predates better-auth, so ids the plugin
     generates for it have to be uuids. Safe for the tables better-auth already
     owns: `user`, `session`, `account` and `verification` all key on `text`, so
     existing rows keep the ids they have and only new ones change shape.
   *
     A function rather than the built-in `'uuid'`, which does not mean "generate
     a uuid in JS" — it means "let the database do it", and none of the
     better-auth tables have a default on `id`. Using it makes every sign-up
     fail with `Failed to create user` on a not-null violation. */
  advanced: { database: { generateId: () => randomUUID() } },
};

/* The instance every request goes through. Sign-up is closed unless the
   operator opts in, which is the product's stated security posture. */
export const auth = betterAuth({
  ...shared,
  emailAndPassword: {
    enabled: true,
    disableSignUp: process.env.BETTER_AUTH_ALLOW_SIGN_UP !== 'true',
  },
  plugins: [membership(), tanstackStartCookies()],
});

/* Redeeming an invitation needs sign-up permitted, and `disableSignUp` is
 * enforced inside the sign-up handler itself — so `auth.api.signUpEmail` on the
 * instance above throws `EMAIL_PASSWORD_SIGN_UP_DISABLED` regardless of being
 * called server-side. `admin/scripts/migrate.ts` hits the same wall and solves
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
