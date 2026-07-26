import { createFileRoute, Link, Outlet, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "../lib/auth-client.js";
import { createIdentity, listIdentities } from "../lib/management.js";
import { getNavCounts } from "../lib/knowledge.js";
import { getSession } from "../lib/session.js";
import { readFailure } from "../lib/read-failure.js";
import { AppShell, SealChip, accessionOf } from "../components/chrome.js";
import { CredentialTag, ROLES, type Identity, type Issued, type Role } from "../components/identity.js";

export type IdentitySearch = { after?: string };

/* The cursor is one search param rather than two, so a link carries a single
   opaque token instead of exposing a timestamp and a uuid the reader is
   invited to hand-edit. Malformed values resolve to null and simply return the
   first page — a bad cursor should show the register, not an error. */
function parseCursor(after: string | undefined) {
  if (!after) return null;
  const separator = after.indexOf("|");
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
export const Route = createFileRoute("/identities")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session) throw redirect({ to: "/sign-in" });
    return { holder: session.user.name ?? session.user.email ?? undefined };
  },
  /* The cursor lives in the URL like every other register state, so a page of
     the register is linkable and a reload does not silently jump back to the
     newest holders. */
  validateSearch: (search: Record<string, unknown>): IdentitySearch => ({
    after: typeof search.after === "string" && search.after.includes("|") ? search.after : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    /* Counts are decorative and degrade to a dash; the register reports a read
       failure in full, and two alarms for one fault would be noise. */
    const counts = await getNavCounts().catch(() => undefined);
    const cursor = parseCursor(deps.after);
    try {
      const page = await listIdentities({ data: { cursor } });
      return { counts, page, failure: undefined };
    } catch (cause) {
      return { counts, page: undefined, failure: readFailure(cause, "The register") };
    }
  },
  component: IdentitiesLayout,
});

function IdentitiesLayout() {
  const router = useRouter();
  const navigate = useNavigate();
  const { holder } = Route.useRouteContext();
  const { counts, page, failure } = Route.useLoaderData();
  const { after } = Route.useSearch();

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

  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("writer");
  const [keyLabel, setKeyLabel] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      const result = await createIdentity({ data: { name, role, keyLabel } });
      setIssued(result);
      setIssuing(false);
      setName("");
      setKeyLabel("");
      await router.invalidate();
      await navigate({ to: "/identities/$identityId", params: { identityId: result.identityId } });
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? `${cause.message}. Nothing was issued — adjust the details and try again.`
          : "The identity could not be created. Nothing was issued — try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <AppShell
      title="Identities"
      accession="Access register"
      holder={holder}
      counts={counts}
      onSignOut={async () => {
        await authClient.signOut();
        router.navigate({ to: "/sign-in" });
      }}
      actions={
        <button
          type="button"
          className="btn btn--primary"
          disabled={Boolean(failure)}
          onClick={() => setIssuing(true)}
        >
          Issue identity
        </button>
      }
    >
      <div className="panes">
        <section className="index" aria-label="Identity register">
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
              <button type="button" className="btn btn--quiet" onClick={() => void router.invalidate()}>
                Retry
              </button>
            </div>
          )}

          {!failure && identities.length === 0 && (
            <p className="empty index__note">
              No identities yet. Issue one to give an agent a credential it can
              present at <code className="register">/mcp</code>.
            </p>
          )}

          <ul className="index__list">
            {identities.map((identity) => {
              const live = identity.keys.filter((key) => !key.revokedAt).length;
              return (
                <li key={identity.id}>
                  <Link
                    to="/identities/$identityId"
                    params={{ identityId: identity.id }}
                    className={`entry${identity.disabled_at ? " entry--disabled" : ""}`}
                    activeProps={{ "aria-current": "page" }}
                    onClick={() => setIssuing(false)}
                  >
                    <span className="entry__name">{identity.name}</span>
                    <span className="entry__accession">
                      {accessionOf(identity.id)} · {live} live · {identity.keys.length} total
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
                <Link to="/identities" search={{}} className="btn btn--quiet">
                  Newest
                </Link>
              )}
              {hasMore && last && (
                <Link
                  to="/identities"
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
          {issued && <CredentialTag issued={issued} onDismiss={() => setIssued(undefined)} />}

          {issuing ? (
            <form onSubmit={submit}>
              <div className="bench__head">
                <div>
                  <span className="label">New holder</span>
                  <h2>Issue identity</h2>
                </div>
              </div>

              <div className="bench__section bench__form">
                <label className={`field${error ? " field--error" : ""}`}>
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
                    {ROLES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={`field${error ? " field--error" : ""}`}>
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
                    {pending ? "Issuing…" : "Issue identity and credential"}
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
