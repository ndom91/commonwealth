import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { authClient } from '../lib/auth-client.js';
import { getSession } from '../lib/session.js';

export const Route = createFileRoute('/sign-in')({
  beforeLoad: async () => {
    if (await getSession()) throw redirect({ to: '/identities' });
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
    router.navigate({ to: '/identities' });
  }

  return (
    <main className="intake">
      <span className="intake__plate">Team knowledge base</span>

      <form className="intake__form" onSubmit={submit}>
        <div>
          <span className="label">Intake</span>
          <h1>Sign in</h1>
          <p className="prose">
            Issue and void the credentials your agents present, and curate what they are allowed to
            treat as true.
          </p>
        </div>

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
