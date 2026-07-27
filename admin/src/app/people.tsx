import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { AppShell } from '../components/chrome.js';
import { Stamp } from '../components/stamp.js';
import { authClient } from '../lib/auth-client.js';
import { getNavCounts } from '../lib/knowledge.js';
import {
  type Invitation,
  invitePerson,
  listInvitations,
  listPeople,
  type Person,
  removePerson,
  revokeInvitation,
  updatePersonRole,
} from '../lib/management.js';
import { readFailure } from '../lib/read-failure.js';
import { can, ROLE_SUMMARY, ROLES, type Role } from '../lib/roles.js';
import { getViewer } from '../lib/session.js';

/* Who can open the cabinet, and how far.
 *
 * Filed under Access beside Identities rather than under Settings, because it
 * is the same kind of thing the drawer already holds: a register of holders.
 * Identities are the agent ones, these are the human ones. Settings is your own
 * account and stays behind the signed-in name.
 *
 * A single bench, not the register/bench split Sources and Identities use.
 * There is nothing here to browse — a team is a handful of people, listed in
 * full, and a pending invitation is a live credential that has to be visible
 * next to them. */
export const Route = createFileRoute('/people')({
  beforeLoad: async () => {
    const viewer = await getViewer();
    if (!viewer) throw redirect({ to: '/sign-in' });
    /* Enforced server-side too, in `requireMember('admin')`. This only spares a
       non-admin the sight of a page that would answer with a refusal. */
    if (!can(viewer.role, 'admin')) throw redirect({ to: '/sources', search: {} });
    return viewer;
  },
  loader: async () => {
    const counts = await getNavCounts().catch(() => undefined);
    try {
      const [people, invitations] = await Promise.all([listPeople(), listInvitations()]);
      return { counts, people, invitations, failure: undefined };
    } catch (cause) {
      return {
        counts,
        people: [],
        invitations: [],
        failure: readFailure(cause, 'The people register'),
      };
    }
  },
  component: People,
});

function People() {
  const router = useRouter();
  const { holder, role } = Route.useRouteContext();
  const {
    counts,
    people: loadedPeople,
    invitations: loadedInvitations,
    failure,
  } = Route.useLoaderData();
  const [inviting, setInviting] = useState(false);

  /* Cast at the point of use, as the other registers do — a server function's
     return type does not survive the trip through the loader. */
  const people = (loadedPeople ?? []) as unknown as Person[];
  const invitations = (loadedInvitations ?? []) as unknown as Invitation[];

  return (
    <AppShell
      title="People"
      accession="Access · people"
      holder={holder}
      role={role}
      counts={counts}
      onSignOut={async () => {
        await authClient.signOut();
        router.navigate({ to: '/sign-in' });
      }}
    >
      <section className="detail" aria-label="People">
        <div className="bench__head">
          <div>
            <span className="label">Everyone who can sign in to this workspace</span>
            <h2>
              {people.length} {people.length === 1 ? 'person' : 'people'}
            </h2>
          </div>
          <div className="bench__seal">
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => setInviting((open) => !open)}
            >
              {inviting ? 'Cancel' : 'Invite'}
            </button>
          </div>
        </div>

        {inviting && (
          <Invite
            onDone={async () => {
              await router.invalidate();
            }}
            onClose={() => setInviting(false)}
          />
        )}

        {failure ? (
          <p className="notice" role="alert">
            {failure}
          </p>
        ) : (
          <>
            <div className="bench__section">
              <span className="label">Holding an account</span>
              <div className="stubs">
                {people.map((person) => (
                  <PersonRow key={person.id} person={person} />
                ))}
              </div>
            </div>

            <Invitations invitations={invitations} />
          </>
        )}

        <p className="line__caption">
          Sign-up is closed on this instance and stays that way — the public endpoint refuses
          everyone, so an invitation is the only way in.
        </p>
      </section>
    </AppShell>
  );
}

/* One person, their role, and the two things an administrator can do about it.
 *
 * The role is a live control rather than a label behind an edit button: there
 * are four values and changing one is a single decision, so a select that saves
 * on change is fewer steps than any form. Removal keeps its word and gains a
 * confirmation, because it is the one action here that cannot be undone from
 * this page. */
function PersonRow({ person }: { person: Person }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();

  async function act(work: () => Promise<unknown>, fallback: string) {
    setPending(true);
    setError(undefined);
    try {
      await work();
      await router.invalidate();
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : fallback);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="stub">
      <span className="stub__label">
        {person.name}
        {person.isYou && ' — you'}
      </span>
      <span className="stub__meta register">
        {person.email} · since <Stamp at={person.createdAt} withTime />
      </span>
      <span className="stub__action">
        <label className="field field--inline stub__role">
          <span className="sr-only">Role for {person.name}</span>
          <select
            value={person.role}
            disabled={pending}
            onChange={(event) =>
              act(
                () =>
                  updatePersonRole({
                    data: { userId: person.id, role: event.target.value as Role },
                  }),
                'That role could not be changed.'
              )
            }
          >
            {ROLES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        {/* The slot is always present, empty on your own row, so the role
            selects stay in one column. No way to remove yourself: the server
            refuses it regardless — a register nobody can reach is not a
            recoverable state — but offering the control and then explaining is
            worse than not offering it. */}
        <span className="stub__slot">
          {!person.isYou &&
            (confirming ? (
              <>
                <button
                  type="button"
                  className="btn btn--sm btn--void"
                  disabled={pending}
                  onClick={() =>
                    act(
                      () => removePerson({ data: { userId: person.id } }),
                      'That person could not be removed.'
                    )
                  }
                >
                  {pending ? 'Removing…' : 'Confirm'}
                </button>
                <button
                  type="button"
                  className="btn btn--sm btn--quiet"
                  onClick={() => setConfirming(false)}
                >
                  Keep
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn--sm btn--void"
                onClick={() => setConfirming(true)}
              >
                Remove
              </button>
            ))}
        </span>
      </span>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* Outstanding links, which are credentials to this surface until they are used,
   expire or are revoked. Listing them is what makes "who has a way in right
   now" answerable; an expired one stays visible because knowing a link went
   unused is the difference between chasing someone and reissuing. */
function Invitations({ invitations }: { invitations: Invitation[] }) {
  const router = useRouter();
  const [revoking, setRevoking] = useState<string>();
  const [error, setError] = useState<string>();

  if (invitations.length === 0) return null;

  return (
    <div className="bench__section">
      <span className="label">Invited, not yet joined</span>
      <div className="stubs">
        {invitations.map((invitation) => (
          <div className="stub" key={invitation.id}>
            <span className="stub__label">
              {invitation.name} — {invitation.role}
            </span>
            <span className="stub__meta register">
              {invitation.email} · invited by {invitation.invitedBy} ·{' '}
              {invitation.expired ? 'expired ' : 'expires '}
              <Stamp at={invitation.expiresAt} withTime />
            </span>
            <span className="stub__action">
              {invitation.expired && <span className="label">Expired</span>}
              <button
                type="button"
                className="btn btn--sm btn--void"
                disabled={revoking === invitation.id}
                onClick={async () => {
                  setRevoking(invitation.id);
                  setError(undefined);
                  try {
                    await revokeInvitation({ data: { invitationId: invitation.id } });
                    await router.invalidate();
                  } catch (cause) {
                    setError(
                      cause instanceof Error && cause.message
                        ? cause.message
                        : 'That invitation could not be revoked.'
                    );
                  } finally {
                    setRevoking(undefined);
                  }
                }}
              >
                {revoking === invitation.id ? 'Revoking…' : 'Revoke'}
              </button>
            </span>
          </div>
        ))}
      </div>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* No password field, deliberately. The old form took one, showed it to the
 * issuer, and told the recipient to replace it — which is an admission that the
 * issuer should never have had it. The link authorises creating exactly one
 * account, once, and the password is chosen at the other end.
 *
 * Shown once, like an agent credential: there is no mailer here, so the link is
 * handed over by whatever channel the team already uses, and the only copy is
 * the one on screen.
 *
 * The role has no preselected value. A default would be a decision nobody made,
 * and the two plausible defaults are wrong in opposite directions — reader
 * makes every new teammate wait on a second admin action, writer hands out the
 * corpus by omission. */
function Invite({ onDone, onClose }: { onDone: () => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [link, setLink] = useState<string>();
  const [added, setAdded] = useState<string>();
  const [copied, setCopied] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      const result = await invitePerson({ data: { name, email, role: role as Role } });
      if (result.added) {
        setAdded(result.email);
        onClose();
      } else if (result.token) {
        setLink(`${window.location.origin}/invite/${result.token}`);
      }
      setName('');
      setEmail('');
      setRole('');
      await onDone();
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? `${cause.message} Nothing was changed.`
          : 'That invitation could not be created. Nothing was changed.'
      );
    } finally {
      setPending(false);
    }
  }

  if (added) {
    return (
      <p className="bench__consequence">
        {added} already had an account, so they were added to this workspace directly. No invitation
        was needed and no password changed.
      </p>
    );
  }

  if (link) {
    return (
      <div className="bench__inline">
        <span className="label">Invitation link</span>
        <p className="issued__secret register">{link}</p>
        <div className="bench__controls">
          <button
            type="button"
            className="btn btn--primary"
            onClick={async () => {
              await navigator.clipboard.writeText(link);
              setCopied(true);
            }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <button type="button" className="btn btn--quiet" onClick={onClose}>
            Done
          </button>
        </div>
        <p className="line__caption">
          Copy it now — it is not stored and will not be shown again. It works once, expires in
          seven days, and can be revoked below until it is used. Send it however you already talk to
          each other; they choose their own password, and you never see it.
        </p>
      </div>
    );
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
        <span className="label">Role</span>
        <select
          required
          value={role}
          disabled={pending}
          onChange={(event) => setRole(event.target.value as Role)}
        >
          <option value="" disabled>
            Choose what they may do
          </option>
          {ROLES.map((value) => (
            <option key={value} value={value}>
              {value} — {ROLE_SUMMARY[value]}
            </option>
          ))}
        </select>
      </label>
      <p className="line__caption">
        Produces a single-use link to pass on. An address that already has an account is added to
        this workspace instead — that needs no link and no password.
      </p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <div className="bench__controls">
        <button className="btn btn--primary" disabled={pending}>
          {pending ? 'Creating…' : 'Create invitation'}
        </button>
      </div>
    </form>
  );
}
