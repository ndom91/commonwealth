import { createFileRoute, Link, Outlet, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { authClient } from "../lib/auth-client.js";
import { getSession } from "../lib/session.js";
import { getNavCounts, listSources } from "../lib/knowledge.js";
import { AppShell, SealChip, accessionOf, authoritySeal, stamp } from "../components/chrome.js";
import { readFailure } from "../lib/read-failure.js";

/* Filters live in the URL rather than component state: a filtered register is
   a thing people send each other, and the review queue hands off into it. */
export type SourceFilters = {
  authority?: "unverified" | "approved" | "canonical";
  type?: "note" | "upload";
  status?: "active" | "deleted" | "failed";
};

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;

export const Route = createFileRoute("/sources")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session) throw redirect({ to: "/sign-in" });
    return { holder: session.user.email ?? session.user.name ?? undefined };
  },
  validateSearch: (search: Record<string, unknown>): SourceFilters => ({
    authority: oneOf(search.authority, ["unverified", "approved", "canonical"] as const),
    type: oneOf(search.type, ["note", "upload"] as const),
    status: oneOf(search.status, ["active", "deleted", "failed"] as const),
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
    try {
      const register = await listSources({
        data: { authority: deps.authority, sourceType: deps.type, status: deps.status },
      });
      return { counts, register, failure: undefined };
    } catch (cause) {
      return { counts, register: undefined, failure: readFailure(cause, "The register") };
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
};

function Sources() {
  const router = useRouter();
  const navigate = useNavigate({ from: "/sources" });
  const { holder } = Route.useRouteContext();
  const filters = Route.useSearch();
  const { counts, register, failure } = Route.useLoaderData();

  const sources = (register?.sources ?? []) as unknown as SourceRow[];
  const hasMore = register?.hasMore ?? false;

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
    >
      <div className="panes">
        <section className="index" aria-label="Source register">
          <div className="index__head">
            <span className="label">Sources</span>
            <span className="label register">
              {failure ? "—" : `${sources.length}${hasMore ? "+" : ""}`}
            </span>
          </div>

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
          </div>

          {failure && (
            <p className="notice index__note" role="alert">
              {failure}
            </p>
          )}

          {!failure && sources.length === 0 && (
            <p className="empty index__note">
              No sources match. Agents submit knowledge over MCP with{" "}
              <code className="register">submit_note</code> and{" "}
              <code className="register">submit_document</code>.
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
                  activeProps={{ "aria-current": "true" }}
                >
                  <span className="entry__name">{source.title}</span>
                  <span className="entry__accession">
                    {accessionOf(source.id)} · r{source.revision_number} ·{" "}
                    {stamp(source.content_updated_at)}
                    {source.author ? ` · ${source.author}` : ""}
                  </span>
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
