import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { authClient } from '../lib/auth-client.js';
import { acceptInvitation, readInvitation } from '../lib/management.js';
import { ROLE_SUMMARY, type Role } from '../lib/roles.js';

/* The one page in the product a stranger is meant to reach.
 *
 * Unauthenticated by necessity — whoever opens this has no account yet, which
 * is the entire point. The token in the URL is the authorisation: 256 bits,
 * single-use, expiring, and stored only as a digest, so this route grants
 * exactly one thing and only to whoever was handed the link.
 *
 * Sign-up remains closed. This does not go through better-auth's public
 * sign-up route, which still refuses everyone; the account is created
 * server-side by `acceptInvitation` against a claimed invitation. */
export const Route = createFileRoute('/invite/$token')({
  loader: async ({ params }) => {
    try {
      return { invitation: await readInvitation({ data: { token: params.token } }), failure: null };
    } catch (cause) {
      return {
        invitation: null,
        failure:
          cause instanceof Error && cause.message
            ? cause.message
            : 'That invitation link is not valid.',
      };
    }
  },
  component: AcceptInvite,
});

function AcceptInvite() {
  const router = useRouter();
  const { token } = Route.useParams();
  const { invitation, failure } = Route.useLoaderData();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  /* Expired, spent, revoked and never-issued all land here. The loader has
     already decided which sentence applies — they send the reader to different
     places, and a single "invalid link" would send them nowhere. */
  if (!invitation) {
    return (
      <main className="intake">
        <span className="intake__plate">Team knowledge base</span>
        <div className="intake__form">
          <div>
            <span className="label">Invitation</span>
            <h1>This link cannot be used</h1>
            <p className="prose">{failure}</p>
          </div>
          <Link to="/sign-in" className="btn btn--quiet">
            Go to sign in
          </Link>
        </div>
      </main>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    if (password !== confirm) {
      setError('The password and its confirmation do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }
    setPending(true);
    try {
      const { email } = await acceptInvitation({ data: { token, password } });
      /* `provisioning` mints no session by design, so accepting leaves them
         signed out. They are holding the password they just chose, so sign them
         in with it rather than bouncing them to a form to retype it. */
      const signedIn = await authClient.signIn.email({ email, password });
      if (signedIn.error) {
        router.navigate({ to: '/sign-in' });
        return;
      }
      router.navigate({ to: '/sources', search: {} });
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : 'The account could not be created. Nothing was changed.'
      );
      setPending(false);
    }
  }

  /* Cast at the point of use, as the registers do — a server function's return
     type does not survive the trip through the loader. */
  const role = invitation.role as Role;

  return (
    <main className="intake">
      <span className="intake__plate">Team knowledge base</span>

      <form className="intake__form" onSubmit={submit}>
        <div>
          <span className="label">Invitation</span>
          <h1>Choose a password</h1>
          {/* The role is stated before the password is chosen, not discovered
              afterwards from which drawers happen to be missing. Someone
              invited as a reader should know that is what they are accepting. */}
          <p className="prose">
            {invitation.invitedBy} invited <b>{invitation.email}</b> to this knowledge base as{' '}
            <b>{role}</b> — {ROLE_SUMMARY[role].toLowerCase()}. Pick a password; nobody else will
            see it, including whoever invited you.
          </p>
        </div>

        <label className={`field${error ? ' field--error' : ''}`}>
          <span className="label">Password</span>
          <input
            required
            autoFocus
            type="password"
            autoComplete="new-password"
            aria-invalid={error ? true : undefined}
            value={password}
            disabled={pending}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
          />
        </label>

        <label className="field">
          <span className="label">Confirm password</span>
          <input
            required
            type="password"
            autoComplete="new-password"
            value={confirm}
            disabled={pending}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </label>

        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}

        <button className="btn btn--primary" disabled={pending}>
          {pending ? 'Creating your account…' : 'Create account'}
        </button>
      </form>
    </main>
  );
}
