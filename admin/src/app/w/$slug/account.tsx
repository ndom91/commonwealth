import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { AppShell } from '../../../components/chrome.js';
import { authClient } from '../../../lib/auth-client.js';
import { getSession } from '../../../lib/session.js';

/* Your own account, and nothing else.
 *
 * Called Account rather than Settings, and moved off that path, now that the
 * workspace has settings of its own. Two pages sharing the plainer word would
 * have been two pages nobody could name: one grants people access to a shared
 * corpus, the other changes your display name. The chrome had already half
 * argued the split by putting this behind the signed-in name instead of in a
 * drawer, because it is *yours*.
 *
 * Reachable at every role: changing your own name and password is not a
 * privilege. */
export const Route = createFileRoute('/w/$slug/account')({
  /* Your own account, so nothing here is workspace-scoped — but it is reached
     from a workspace and the rail stays put, so it lives under the same layout.
     That layout has already established who you are; this only fetches the
     name and email the form edits. */
  beforeLoad: async () => {
    const session = await getSession();
    if (!session) throw redirect({ to: '/sign-in' });
    return { account: { name: session.user.name ?? '', email: session.user.email ?? '' } };
  },
  component: Account,
});

function Account() {
  const router = useRouter();
  const viewer = Route.useRouteContext();
  const { account } = viewer;

  return (
    <AppShell
      title="Account"
      accession="Your account"
      {...viewer}
      onSignOut={async () => {
        await authClient.signOut();
        router.navigate({ to: '/sign-in' });
      }}
    >
      <section className="detail" aria-label="Your account">
        <div className="bench__head">
          <div>
            <span className="label">Signed in as</span>
            <h2>{account.email}</h2>
          </div>
        </div>

        <DisplayName current={account.name} />
        <Password />
      </section>
    </AppShell>
  );
}

/* The name every source and revision you author is filed under. Stated on the
   field rather than left to be discovered, because the default is "Admin" and
   nobody would guess that it is what the register prints. */
function DisplayName({ current }: { current: string }) {
  const router = useRouter();
  const [name, setName] = useState(current);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    setSaved(false);
    const result = await authClient.updateUser({ name: name.trim() });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? 'That name could not be saved. Nothing was changed.');
      return;
    }
    setSaved(true);
    await router.invalidate();
  }

  return (
    <div className="bench__section">
      <span className="label">Display name</span>
      <form className="bench__form" onSubmit={submit}>
        <label className={`field${error ? ' field--error' : ''}`}>
          <span className="label">Name</span>
          <input
            required
            value={name}
            aria-invalid={error ? true : undefined}
            disabled={pending}
            onChange={(event) => {
              setName(event.target.value);
              setSaved(false);
            }}
          />
        </label>
        <p className="line__caption">
          Printed on every source and revision you author, and in the cabinet foot. Agent holders
          have names of their own — this one is yours.
        </p>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <div className="bench__controls">
          <button
            className="btn btn--primary"
            disabled={pending || !name.trim() || name.trim() === current}
          >
            {pending ? 'Saving…' : 'Save name'}
          </button>
          {saved && (
            <span className="line__caption" role="status">
              Saved.
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

/* Requires the current password and revokes every other session. A rotation is
   usually a response to a leak, and changing the secret while leaving the
   leaked session signed in would only look like security. */
function Password() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [changed, setChanged] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setChanged(false);
    if (next !== confirm) {
      setError('The new password and its confirmation do not match.');
      return;
    }
    /* Matches better-auth's `minPasswordLength` default, which is what actually
       enforces this — checking here only saves a round trip. */
    if (next.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }
    setPending(true);
    const result = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? 'That password could not be changed. Nothing was changed.');
      return;
    }
    setCurrent('');
    setNext('');
    setConfirm('');
    setChanged(true);
  }

  return (
    <div className="bench__section">
      <span className="label">Password</span>
      <form className="bench__form" onSubmit={submit}>
        <label className={`field${error ? ' field--error' : ''}`}>
          <span className="label">Current password</span>
          <input
            required
            type="password"
            autoComplete="current-password"
            value={current}
            disabled={pending}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="label">New password</span>
          <input
            required
            type="password"
            autoComplete="new-password"
            value={next}
            disabled={pending}
            onChange={(event) => setNext(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="label">Confirm new password</span>
          <input
            required
            type="password"
            autoComplete="new-password"
            value={confirm}
            disabled={pending}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </label>
        <p className="line__caption">
          Signs out every other session. If this instance was bootstrapped from
          <code> BOOTSTRAP_ADMIN_PASSWORD</code>, that value is still sitting in your{' '}
          <code>.env</code> — changing it here is what retires it.
        </p>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <div className="bench__controls">
          <button className="btn btn--primary" disabled={pending}>
            {pending ? 'Changing…' : 'Change password'}
          </button>
          {changed && (
            <span className="line__caption" role="status">
              Password changed. Other sessions signed out.
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
