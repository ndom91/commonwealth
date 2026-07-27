import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { AppShell } from '../components/chrome.js';
import { Stamp } from '../components/stamp.js';
import { authClient } from '../lib/auth-client.js';
import { getNavCounts } from '../lib/knowledge.js';
import { type Administrator, createAdministrator, listAdministrators } from '../lib/management.js';
import { readFailure } from '../lib/read-failure.js';
import { getSession } from '../lib/session.js';

/* The only surface that is about the people holding keys to the cabinet rather
   than about what is in it. Two concerns, one page, because they answer the
   same question — who can open this, and how do they change their own key.
 *
 * A single bench rather than the register/bench split used by Sources and
 * Identities: there is nothing here to browse. Administrators are a handful of
 * people, listed in full. */
export const Route = createFileRoute('/settings')({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session) throw redirect({ to: '/sign-in' });
    return {
      holder: session.user.name ?? session.user.email ?? undefined,
      account: { name: session.user.name ?? '', email: session.user.email ?? '' },
    };
  },
  loader: async () => {
    const counts = await getNavCounts().catch(() => undefined);
    try {
      return { counts, administrators: await listAdministrators(), failure: undefined };
    } catch (cause) {
      return {
        counts,
        administrators: [] as Administrator[],
        failure: readFailure(cause, 'The administrator list'),
      };
    }
  },
  component: Settings,
});

function Settings() {
  const router = useRouter();
  const { holder, account } = Route.useRouteContext();
  const { counts, administrators, failure } = Route.useLoaderData();

  return (
    <AppShell
      title="Settings"
      accession="Account and access"
      holder={holder}
      counts={counts}
      onSignOut={async () => {
        await authClient.signOut();
        router.navigate({ to: '/sign-in' });
      }}
    >
      <section className="detail" aria-label="Settings">
        <div className="bench__head">
          <div>
            <span className="label">Signed in as</span>
            <h2>{account.email}</h2>
          </div>
        </div>

        <DisplayName current={account.name} />
        <Password />
        <Administrators administrators={administrators} failure={failure} />
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

function Administrators({
  administrators,
  failure,
}: {
  administrators: Administrator[];
  failure: string | undefined;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);

  return (
    <div className="bench__section">
      <div className="bench__section-head">
        <span className="label">Administrators</span>
        <button
          type="button"
          className="btn btn--sm btn--quiet"
          onClick={() => setAdding((open) => !open)}
        >
          {adding ? 'Cancel' : 'Add administrator'}
        </button>
      </div>

      {adding && (
        <AddAdministrator
          onAdded={async () => {
            setAdding(false);
            await router.invalidate();
          }}
        />
      )}

      {failure && (
        <p className="notice" role="alert">
          {failure}
        </p>
      )}

      {!failure && (
        <div className="stubs">
          {administrators.map((administrator) => (
            <div className="stub" key={administrator.id}>
              <span className="stub__label">
                {administrator.name}
                {administrator.isYou && ' — you'}
              </span>
              <span className="stub__meta register">
                {administrator.email} · since <Stamp at={administrator.createdAt} withTime />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* No mailer exists in this project, so there is no invitation to send. The
   initial password is shown once and handed over the way an agent credential
   is, and the recipient replaces it from the section above — which is what
   keeps a password the issuer has seen from being permanent. */
function AddAdministrator({ onAdded }: { onAdded: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      await createAdministrator({ data: { name, email, password } });
      await onAdded();
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? `${cause.message} Nothing was changed.`
          : 'The administrator could not be added. Nothing was changed.'
      );
      setPending(false);
    }
  }

  return (
    <form className="bench__inline" onSubmit={submit}>
      <label className={`field${error ? ' field--error' : ''}`}>
        <span className="label">Name</span>
        <input
          required
          autoFocus
          value={name}
          disabled={pending}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="field">
        <span className="label">Email</span>
        <input
          required
          type="email"
          autoComplete="off"
          value={email}
          disabled={pending}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label className="field">
        <span className="label">Initial password</span>
        <input
          required
          type="text"
          autoComplete="off"
          value={password}
          disabled={pending}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 8 characters"
        />
      </label>
      <p className="line__caption">
        Shown as text so you can copy it once and pass it on. They should change it as soon as they
        sign in. An address that already has an account is promoted rather than recreated.
      </p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <div className="bench__controls">
        <button className="btn btn--primary" disabled={pending}>
          {pending ? 'Adding…' : 'Add administrator'}
        </button>
      </div>
    </form>
  );
}
