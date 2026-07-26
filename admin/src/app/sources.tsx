import { createFileRoute, Link, Outlet, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { authClient } from "../lib/auth-client.js";
import { getSession } from "../lib/session.js";
import { getNavCounts, listSources, listSubmitters, searchSources } from "../lib/knowledge.js";
import { Search, X } from "lucide-react";
import { AppShell, IconButton, SealChip, accessionOf, authoritySeal, stamp } from "../components/chrome.js";
import { readFailure } from "../lib/read-failure.js";

/* Filters live in the URL rather than component state: a filtered register is
   a thing people send each other, and the review queue hands off into it. */
export type SourceFilters = {
  authority?: "unverified" | "approved" | "canonical";
  type?: "note" | "upload";
  status?: "active" | "deleted" | "failed";
  /* The identity that submitted the source — `sources.created_by`, an agent
     holder rather than an administrator. */
  submitter?: string;
  /* A keyword query narrows the same filtered register rather than replacing
     it. "Everything this agent submitted, about deployments" is one question,
     not two. */
  q?: string;
};

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* `ts_headline` wraps matched terms in STX/ETX rather than markup. Splitting on
   them and returning React children keeps the highlight real while every piece
   of body text stays escaped — source content is never parsed as HTML. */
function highlight(excerpt: string) {
  return excerpt.split("\u0002").flatMap((chunk, index) => {
    const [matched, rest] = chunk.split("\u0003");
    if (index === 0) return [<span key={index}>{chunk}</span>];
    return [<mark key={`m${index}`}>{matched}</mark>, <span key={index}>{rest ?? ""}</span>];
  });
}

export const Route = createFileRoute("/sources")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session) throw redirect({ to: "/sign-in" });
    return { holder: session.user.name ?? session.user.email ?? undefined };
  },
  validateSearch: (search: Record<string, unknown>): SourceFilters => ({
    authority: oneOf(search.authority, ["unverified", "approved", "canonical"] as const),
    type: oneOf(search.type, ["note", "upload"] as const),
    status: oneOf(search.status, ["active", "deleted", "failed"] as const),
    submitter: typeof search.submitter === "string" && UUID.test(search.submitter) ? search.submitter : undefined,
    q: typeof search.q === "string" && search.q.trim() ? search.q.trim().slice(0, 200) : undefined,
  }),
  loaderDeps: ({ search }) => search,
  /* The register and the rail load here rather than in the component so that
     the bench — a child route — can move both by calling `router.invalidate()`
     after it changes a source's authority or withdraws it. */
  loader: async ({ deps }) => {
    /* Counts are decorative and degrade to a dash. A failure here means the
       database is unreachable, which the register's own message explains in
       full; two alarms for one fault would be noise. */
    const counts = await getNavCounts().catch(() => undefined);
    const filters = {
      authority: deps.authority,
      sourceType: deps.type,
      status: deps.status,
      submitter: deps.submitter,
    };
    try {
      /* Submitters are read alongside the register so the filter offers only
         identities that have actually submitted something. */
      const [register, submitters] = await Promise.all([
        deps.q
          ? searchSources({ data: { ...filters, query: deps.q } }).then((sources) => ({
              sources,
              hasMore: false,
            }))
          : listSources({ data: filters }),
        listSubmitters(),
      ]);
      return { counts, register, submitters, failure: undefined };
    } catch (cause) {
      const submitters: Array<{ id: string; name: string; count: number }> = [];
      return {
        counts,
        register: undefined,
        submitters,
        failure: readFailure(cause, "The register"),
      };
    }
  },
  component: Sources,
});

export type SourceRow = {
  id: string;
  source_type: "note" | "upload";
  status: "active" | "deleted" | "failed";
  authority: "unverified" | "approved" | "canonical";
  created_at: string;
  deleted_at: string | null;
  last_verified_at: string | null;
  title: string;
  revision_number: number;
  content_updated_at: string;
  author: string | null;
  tags: string[];
  is_stale: boolean;
  /* Present only on keyword hits: the best-matching fragment of the body with
     the matched terms delimited. */
  excerpt?: string;
};

function Sources() {
  const router = useRouter();
  const navigate = useNavigate({ from: "/sources" });
  const { holder } = Route.useRouteContext();
  const filters = Route.useSearch();
  const { counts, register, submitters, failure } = Route.useLoaderData();

  const sources = (register?.sources ?? []) as unknown as SourceRow[];
  const holders = submitters as Array<{ id: string; name: string; count: number }>;
  const hasMore = register?.hasMore ?? false;
  const searching = Boolean(filters.q);
  /* An empty register means two different things, and saying the wrong one
     misleads. With a filter or a query applied, sources are being excluded.
     With neither, none has ever been submitted — a first-run state, which on a
     self-hosted instance is what a new team sees before any agent has written
     anything. */
  const narrowed = Boolean(
    filters.authority || filters.type || filters.status || filters.submitter,
  );

  const setFilter = (key: keyof SourceFilters, value: string) =>
    void navigate({ search: (previous: SourceFilters) => ({ ...previous, [key]: value || undefined }) });

  return (
    <AppShell
      title="Sources"
      accession="Knowledge register"
      holder={holder}
      counts={counts}
      onSignOut={async () => {
        await authClient.signOut();
        router.navigate({ to: "/sign-in" });
      }}
      actions={
        <Link to="/sources/new" search={{}} className="btn btn--primary">
          New source
        </Link>
      }
    >
      <div className="panes">
        <section className="index" aria-label="Source register">
          <form
            className="seek"
            onSubmit={(event) => {
              event.preventDefault();
              const value = new FormData(event.currentTarget).get("q");
              void navigate({
                search: (previous: SourceFilters) => ({
                  ...previous,
                  q: typeof value === "string" && value.trim() ? value.trim() : undefined,
                }),
              });
            }}
          >
            <label className="seek__field">
              <span className="label">Keyword search</span>
              <input
                key={filters.q ?? ""}
                name="q"
                type="search"
                defaultValue={filters.q ?? ""}
                placeholder="Words in the body"
                autoComplete="off"
              />
            </label>
            <IconButton type="submit" label="Search" icon={Search} />
            {searching && (
              <IconButton
                label="Clear search"
                icon={X}
                onClick={() =>
                  void navigate({ search: (previous: SourceFilters) => ({ ...previous, q: undefined }) })
                }
              />
            )}
          </form>

          <div className="filters">
            <label className="filters__field">
              <span className="label">Authority</span>
              <select
                value={filters.authority ?? ""}
                onChange={(event) => setFilter("authority", event.target.value)}
              >
                <option value="">All</option>
                <option value="unverified">Unverified</option>
                <option value="approved">Approved</option>
                <option value="canonical">Canonical</option>
              </select>
            </label>
            <label className="filters__field">
              <span className="label">Type</span>
              <select value={filters.type ?? ""} onChange={(event) => setFilter("type", event.target.value)}>
                <option value="">All</option>
                <option value="note">Note</option>
                <option value="upload">Upload</option>
              </select>
            </label>
            <label className="filters__field">
              <span className="label">Status</span>
              <select
                value={filters.status ?? ""}
                onChange={(event) => setFilter("status", event.target.value)}
              >
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="deleted">Withdrawn</option>
                <option value="failed">Failed</option>
              </select>
            </label>
            {holders.length > 0 && (
              <label className="filters__field filters__field--row">
                <span className="label">Submitted by</span>
                <select
                  value={filters.submitter ?? ""}
                  onChange={(event) => setFilter("submitter", event.target.value)}
                >
                  <option value="">Anyone</option>
                  {holders.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name} · {entry.count}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {failure && (
            <p className="notice index__note" role="alert">
              {failure}
            </p>
          )}

          {!failure && sources.length === 0 && (
            <p className="empty index__note">
              {searching ? (
                <>
                  No title or source body matches. Try fewer words, or clear the
                  search to browse the register.
                </>
              ) : narrowed ? (
                <>
                  No sources match these filters. Widen one, or set them all
                  back to All to browse the whole register.
                </>
              ) : (
                <>
                  The register is empty. Agents write to it over MCP with{" "}
                  <code className="register">submit_note</code> and{" "}
                  <code className="register">submit_document</code>; anything
                  they submit appears here for review.
                </>
              )}
            </p>
          )}

          <ul className="index__list">
            {sources.map((source) => (
              <li key={source.id}>
                <Link
                  to="/sources/$sourceId"
                  params={{ sourceId: source.id }}
                  search={filters}
                  className="entry"
                  activeProps={{ "aria-current": "page" }}
                >
                  <span className="entry__name">{source.title}</span>
                  <span className="entry__accession">
                    {accessionOf(source.id)} · r{source.revision_number} ·{" "}
                    {stamp(source.content_updated_at)}
                    {source.author ? ` · ${source.author}` : ""}
                  </span>
                  {source.excerpt && (
                    <span className="entry__excerpt">{highlight(source.excerpt)}</span>
                  )}
                  <span className="entry__role">
                    {source.status === "deleted" ? (
                      <SealChip state="void">Withdrawn</SealChip>
                    ) : source.is_stale ? (
                      <SealChip state="suspended">Stale</SealChip>
                    ) : (
                      <SealChip state={authoritySeal(source.authority)}>{source.authority}</SealChip>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {hasMore && (
            <p className="empty index__note">
              Showing the {sources.length} most recent. Narrow with a filter to
              see older sources.
            </p>
          )}
        </section>

        <Outlet />
      </div>
    </AppShell>
  );
}
