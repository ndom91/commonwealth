import {
  createFileRoute,
  Link,
  Outlet,
  useMatchRoute,
  useNavigate,
  useRouter,
} from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { AppShell, accessionOf, SealChip, SettingsTabs } from '../../../../components/chrome.js';
import { CredentialTag, type Identity, type Issued } from '../../../../components/identity.js';
import { readFailure, writeFailure } from '../../../../lib/failure.js';
import { createIdentity, listIdentities } from '../../../../lib/management.js';
import { can, canGrant, ROLES, type Role } from '../../../../lib/roles.js';
import { documentTitle } from '../../../../lib/title.js';

export type IdentitySearch = { after?: string; mine?: boolean };

/* The cursor is one search param rather than two, so a link carries a single
   opaque token instead of exposing a timestamp and a uuid the reader is
   invited to hand-edit. Malformed values resolve to null and simply return the
   first page — a bad cursor should show the register, not an error. */
function parseCursor(after: string | undefined) {
  if (!after) return null;
  const separator = after.indexOf('|');
  const createdAt = after.slice(0, separator);
  const id = after.slice(separator + 1);
  return createdAt && id ? { createdAt, id } : null;
}

/* The access register, formerly /dashboard.
 *
 * Selection lives in the URL rather than in component state, which is what the
 * rest of the workbench already does. A holder becomes a thing one person can
 * send another, and one `router.invalidate()` after a mutation refreshes the
 * register, the bench and the rail count together — the old route kept its own
 * effect-driven refetch, so there were two ways to reload one page. */
export const Route = createFileRoute('/p/$slug/settings/identities')({
  /* The cursor lives in the URL like every other register state, so a page of
     the register is linkable and a reload does not silently jump back to the
     newest holders. */
  validateSearch: (search: Record<string, unknown>): IdentitySearch => ({
    after:
      typeof search.after === 'string' && search.after.includes('|') ? search.after : undefined,
    /* Absent rather than `false` when off, so the unfiltered register is the
       bare URL and a link to it carries no state a reader has to interpret. */
    mine: search.mine === true || search.mine === 'true' ? true : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, params }) => {
    /* Counts are decorative and degrade to a dash; the register reports a read
       failure in full, and two alarms for one fault would be noise. */
    const cursor = parseCursor(deps.after);
    try {
      const page = await listIdentities({
        data: { project: params.slug, cursor, mine: deps.mine === true },
      });
      return { page, failure: undefined };
    } catch {
      return { page: undefined, failure: readFailure('The register') };
    }
  },
  /* After `validateSearch` — see the note in `sources.tsx`. */
  head: ({ match }) => ({
    meta: [{ title: documentTitle('Identities', match.context.projectName) }],
  }),
  component: IdentitiesLayout,
});

function IdentitiesLayout() {
  const { slug } = Route.useParams();
  const router = useRouter();
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const viewer = Route.useRouteContext();
  const { page, failure } = Route.useLoaderData();
  const { after, mine } = Route.useSearch();

  /* An administrator sees the whole project and may narrow to their own;
     everyone else is already narrowed by the server and is not offered a
     control that could only ever be a no-op. */
  const administers = can(viewer.role, 'admin');
  /* Nobody may issue a credential that outranks them, so the roles that cannot
     be granted are not offered. The server refuses them regardless — this only
     keeps the form from proposing a choice it would reject. */
  const grantable = ROLES.filter((value) => canGrant(viewer.role, value));

  /* Loader data crosses a serialisation boundary, so the router hands it back
     widened. Re-stated here rather than at every use site. */
  const identities: Identity[] = (page?.identities ?? []) as Identity[];
  const hasMore = page?.hasMore ?? false;
  const last = identities[identities.length - 1];

  /* The reveal is layout state, not bench state: creating a holder navigates to
     that holder, and the secret has to survive the navigation. It is shown once
     and never recoverable, so losing it to a route change would mean the
     credential is simply gone. */
  const [issued, setIssued] = useState<Issued>();
  const [issuing, setIssuing] = useState(false);

  const issuedIdentityIsSelected = issued
    ? Boolean(
        matchRoute({
          to: '/p/$slug/settings/identities/$identityId',
          params: { slug, identityId: issued.identityId },
        })
      )
    : false;

  /* A credential belongs to exactly one holder. Leaving its bench redacts the
     one-time reveal instead of allowing it to follow the next selection. */
  useEffect(() => {
    if (issued && !issuedIdentityIsSelected) setIssued(undefined);
  }, [issued, issuedIdentityIsSelected]);

  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('writer');
  const [keyLabel, setKeyLabel] = useState('');
  const [unowned, setUnowned] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      const result = await createIdentity({
        data: { project: slug, name, role, keyLabel, unowned: administers && unowned },
      });
      setIssuing(false);
      setName('');
      setKeyLabel('');
      setUnowned(false);
      await router.invalidate();
      await navigate({
        to: '/p/$slug/settings/identities/$identityId',
        params: { identityId: result.identityId },
      });
      setIssued(result);
    } catch (cause) {
      setError(
        writeFailure(
          cause,
          'The identity could not be created. Nothing was issued — try again.',
          'Nothing was issued — adjust the details and try again.'
        )
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <AppShell
      title="Identities"
      accession="Settings"
      tabs={<SettingsTabs slug={slug} counts={viewer.counts} role={viewer.role} />}
      {...viewer}
      actions={
        <button
          type="button"
          className="btn btn--primary"
          disabled={Boolean(failure)}
          onClick={() => {
            setIssued(undefined);
            setIssuing(true);
          }}
        >
          Issue identity
        </button>
      }
    >
      <div className="panes">
        <section className="index" aria-label="Identity register">
          {/* Not `--flush`: that modifier is the log's, where the filter sits in
              an already-padded pane and so drops the register's gutter. Here the
              gutter is what puts this label in the same column as the HOLDER
              heading and the rows beneath it, and its top padding is what keeps
              it off the tab bar. */}
          {administers && (
            <div className="filters">
              <label className="filters__field filters__field--row">
                <span className="label">Holders</span>
                <select
                  value={mine ? 'mine' : 'all'}
                  onChange={(event) =>
                    void navigate({
                      to: '/p/$slug/settings/identities',
                      params: { slug },
                      /* The cursor is dropped rather than carried: it points
                         into the unfiltered ordering, and a page token from one
                         list applied to another lands somewhere arbitrary. */
                      search: event.target.value === 'mine' ? { mine: true } : {},
                    })
                  }
                >
                  <option value="all">Everyone's</option>
                  <option value="mine">Yours</option>
                </select>
              </label>
            </div>
          )}

          {identities.length > 0 && (
            <div className="index__cols">
              <span className="label">Holder</span>
              <span className="label">Role</span>
            </div>
          )}

          {failure && (
            <div className="index__note index__note--stack">
              <p className="notice" role="alert">
                {failure}
              </p>
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => void router.invalidate()}
              >
                Retry
              </button>
            </div>
          )}

          {/* Two different facts, and saying the first when the second is true
              would tell an administrator filtering to their own that the
              project is empty. A non-administrator's register is always
              filtered, so they always get the second. */}
          {!failure && identities.length === 0 && (
            <p className="empty index__note">
              {administers && !mine ? 'No identities yet.' : 'You hold no identities yet.'} Issue
              one to give an agent a credential it can present at{' '}
              <code className="register">/mcp</code>.
            </p>
          )}

          <ul className="index__list">
            {identities.map((identity) => {
              const live = identity.keys.filter((key) => !key.revokedAt).length;
              return (
                <li key={identity.id}>
                  <Link
                    to="/p/$slug/settings/identities/$identityId"
                    params={{ slug, identityId: identity.id }}
                    className={`entry${identity.disabled_at ? ' entry--disabled' : ''}`}
                    activeProps={{ 'aria-current': 'page' }}
                    onClick={() => setIssuing(false)}
                  >
                    <span className="entry__name">{identity.name}</span>
                    <span className="entry__accession">
                      {accessionOf(identity.id)} · {live} live · {identity.keys.length} total ·{' '}
                      {identity.owner ?? 'unowned'}
                    </span>
                    <span className="entry__role">
                      {identity.disabled_at ? (
                        <SealChip state="suspended">Disabled</SealChip>
                      ) : identity.auto_approve ? (
                        <SealChip state="signed">{identity.role} · trusted</SealChip>
                      ) : (
                        <span className="role">{identity.role}</span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* A register of credentials has no filters to narrow by, so a holder
              you cannot page to is a key you cannot revoke. Both directions are
              offered rather than only "more". */}
          {(hasMore || after) && (
            <div className="index__note index__page">
              {after && (
                <Link to="/p/$slug/settings/identities" search={{}} className="btn btn--quiet">
                  Newest
                </Link>
              )}
              {hasMore && last && (
                <Link
                  to="/p/$slug/settings/identities"
                  search={{ after: `${last.created_at}|${last.id}` }}
                  className="btn btn--quiet"
                >
                  Earlier holders
                </Link>
              )}
            </div>
          )}
        </section>

        {/* The detail pane belongs to the layout rather than to each child, so
            the credential tag can sit above whichever bench is showing. Children
            render their contents, not their own section. */}
        <section className="detail" aria-label="Selected holder">
          {issued && issuedIdentityIsSelected && (
            <CredentialTag issued={issued} onDismiss={() => setIssued(undefined)} />
          )}

          {issuing ? (
            <form onSubmit={submit}>
              <div className="bench__head">
                <div>
                  <span className="label">New holder</span>
                  <h2>Issue identity</h2>
                </div>
              </div>

              <div className="bench__section bench__form">
                <label className={`field${error ? ' field--error' : ''}`}>
                  <span className="label">Holder name</span>
                  <input
                    required
                    autoFocus
                    aria-invalid={error ? true : undefined}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Claude Code — billing"
                  />
                </label>

                <label className="field">
                  <span className="label">Role</span>
                  <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
                    {grantable.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>

                {!administers && (
                  <p className="amend__consequence">
                    A credential cannot do more than you can, so the list stops at{' '}
                    <span className="role">{viewer.role}</span>. This holder will be yours, and is
                    retired if you leave this project.
                  </p>
                )}

                {administers && (
                  <label className="field">
                    <span className="label">Owner</span>
                    <select
                      value={unowned ? 'nobody' : 'you'}
                      onChange={(event) => setUnowned(event.target.value === 'nobody')}
                    >
                      <option value="you">You</option>
                      <option value="nobody">Nobody — shared</option>
                    </select>
                  </label>
                )}

                {administers && (
                  <p className="amend__consequence">
                    {unowned
                      ? 'A shared holder survives anyone leaving the project. Nothing retires it automatically; voiding it is a deliberate act.'
                      : 'Yours. Removing you from this project voids its credentials and disables it.'}
                  </p>
                )}

                <label className={`field${error ? ' field--error' : ''}`}>
                  <span className="label">Credential label</span>
                  <input
                    required
                    aria-invalid={error ? true : undefined}
                    value={keyLabel}
                    onChange={(event) => setKeyLabel(event.target.value)}
                    placeholder="Ada's local Claude Code"
                  />
                </label>

                {error && (
                  <p className="notice" role="alert">
                    {error}
                  </p>
                )}

                <div className="bench__controls">
                  <button className="btn btn--primary" disabled={pending}>
                    {pending ? 'Issuing…' : 'Issue identity and credential'}
                  </button>
                  <button
                    type="button"
                    className="btn btn--quiet"
                    disabled={pending}
                    onClick={() => {
                      setIssuing(false);
                      setError(undefined);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <Outlet />
          )}
        </section>
      </div>
    </AppShell>
  );
}
