import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { tanstackStartCookies } from 'better-auth/tanstack-start';
import * as schema from '../db/schema.js';
import { db } from './db.js';

const shared = {
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: ['http://localhost:3001', 'http://127.0.0.1:3001'],
  database: drizzleAdapter(db, { provider: 'pg', schema }),
};

/* The instance every request goes through. Sign-up is closed unless the
   operator opts in, which is the product's stated security posture. */
export const auth = betterAuth({
  ...shared,
  emailAndPassword: {
    enabled: true,
    disableSignUp: process.env.BETTER_AUTH_ALLOW_SIGN_UP !== 'true',
  },
  plugins: [tanstackStartCookies()],
});

/* Creating an administrator from inside the product needs sign-up permitted,
   and `disableSignUp` is enforced inside the sign-up handler itself — so
   `auth.api.signUpEmail` on the instance above throws
   `EMAIL_PASSWORD_SIGN_UP_DISABLED` regardless of being called server-side.
   `admin/scripts/migrate.ts` hits the same wall and solves it by forcing the
   env flag for its own process; a long-lived server cannot, because the flag is
   read once at import and would then be open for everyone.
 *
 * So provisioning gets its own instance over the same database: sign-up
 * enabled, reachable only from `createAdministrator`, which is gated on
 * `admin_role`. The public HTTP surface still refuses sign-up.
 *
 * Two deliberate differences from the instance above:
 *
 * - **No `tanstackStartCookies`.** That plugin writes any `set-cookie` the auth
 *   API emits onto the current response, so creating an account would replace
 *   the acting administrator's session with the new user's.
 * - **`autoSignIn: false`.** Belt and braces for the same thing, and it avoids
 *   minting a session row nobody will ever use. It also makes better-auth
 *   answer a duplicate email generically, which is why `createAdministrator`
 *   checks for an existing account before calling this. */
export const provisioning = betterAuth({
  ...shared,
  emailAndPassword: { enabled: true, disableSignUp: false, autoSignIn: false },
});
