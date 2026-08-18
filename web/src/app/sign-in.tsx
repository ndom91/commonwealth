import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { authClient } from '../lib/auth-client.js';
import { getSession } from '../lib/session.js';

export const Route = createFileRoute('/sign-in')({
  beforeLoad: async () => {
    if (await getSession()) throw redirect({ to: '/' });
  },
  component: SignIn,
});

function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const result = await authClient.signIn.email({ email, password });
    if (result.error) {
      setError(
        result.error.message ??
          'Those credentials were not accepted. Check the address and try again.'
      );
      setPending(false);
      return;
    }
    router.navigate({ to: '/' });
  }

  return (
    <main className="intake">
      {/* Most people meet this page having been sent a link by a teammate, with no
          idea what is behind it. So the cabinet half says what this is and what the
          two recurring jobs are, in the same label-and-body grammar the cabinet
          itself uses. Nothing here is a claim the product cannot keep, and nothing
          here is about this instance — none of that is knowable, or anybody's
          business, until somebody is inside it. */}
      <div className="intake__world">
        <span className="label intake__eyebrow">Intake</span>
        <span className="intake__plate">Commonwealth</span>
        <p className="prose">
          One self-hosted knowledge base your agents read over MCP, and whose contents your team
          decides.
        </p>

        <dl className="intake__doors">
          <div className="intake__door">
            <dt className="label">Credential</dt>
            <dd>Issue an identity and key for an agent, or void one that leaked.</dd>
          </div>
          <div className="intake__door">
            <dt className="label">Curate</dt>
            <dd>
              Read what agents have submitted, correct it, and vouch for what is true. Everything
              served carries its source.
            </dd>
          </div>
        </dl>
      </div>

      <form className="intake__form" onSubmit={submit}>
        <h1>Sign in</h1>

        <label className={`field${error ? ' field--error' : ''}`}>
          <span className="label">Email</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-invalid={error ? true : undefined}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label className={`field${error ? ' field--error' : ''}`}>
          <span className="label">Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={error ? true : undefined}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}

        <div className="intake__foot">
          <button className="btn btn--primary" disabled={pending}>
            {pending ? 'Checking…' : 'Sign in'}
          </button>
          <span className="label">Accounts are issued by an administrator</span>
        </div>
      </form>
    </main>
  );
}
