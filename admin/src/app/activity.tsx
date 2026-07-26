import { createFileRoute, Link, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { authClient } from "../lib/auth-client.js";
import { getSession } from "../lib/session.js";
import { getNavCounts, listEventTypes, listEvents } from "../lib/knowledge.js";
import { AppShell, accessionOf, stampAt } from "../components/chrome.js";
import { readFailure } from "../lib/read-failure.js";

type ActivityFilters = { type?: string };

export const Route = createFileRoute("/activity")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session) throw redirect({ to: "/sign-in" });
    return { holder: session.user.name ?? session.user.email ?? undefined };
  },
  validateSearch: (search: Record<string, unknown>): ActivityFilters => ({
    type: typeof search.type === "string" && /^[a-z_]{1,64}$/.test(search.type) ? search.type : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const counts = await getNavCounts().catch(() => undefined);
    try {
      const [log, types] = await Promise.all([
        listEvents({ data: { eventType: deps.type } }),
        listEventTypes(),
      ]);
      return { counts, log, types, failure: undefined };
    } catch (cause) {
      const types: Array<{ eventType: string; count: number }> = [];
      return { counts, log: undefined, types, failure: readFailure(cause, "The log") };
    }
  },
  component: Activity,
});

type EventRow = {
  id: string;
  event_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
  source_id: string | null;
  source_title: string | null;
  actor_agent: string | null;
  actor_admin: string | null;
};

/* Event types are stored as the verb the writer used. Rendering them raw would
   make the log read as a database dump, so each is given the sentence a person
   would say. Anything unmapped falls back to the raw type with underscores
   opened out — a new event type shows up legibly without a code change. */
const PHRASING: Record<string, string> = {
  source_submitted: "Submitted a source",
  source_revised: "Revised a source",
  source_authority_changed: "Changed authority",
  source_deleted: "Withdrew a source",
  source_restored: "Restored a source",
  api_key_created: "Issued a credential",
  api_key_revoked: "Voided a credential",
  identity_amended: "Amended a holder",
  identity_disabled: "Disabled a holder",
  identity_enabled: "Enabled a holder",
  search: "Searched",
};

const phrase = (type: string) => PHRASING[type] ?? type.replace(/_/g, " ");

/* The one line of detail worth carrying on a log row. Everything else stays in
   the source bench or the holder bench, which have room for it. */
function detailOf(event: EventRow): string | null {
  const meta = event.metadata;
  const text = (key: string) => (typeof meta[key] === "string" ? (meta[key] as string) : null);

  if (event.event_type === "search") {
    const query = text("query");
    const count = typeof meta.resultCount === "number" ? meta.resultCount : null;
    if (!query) return null;
    return count === null ? `“${query}”` : `“${query}” — ${count} result${count === 1 ? "" : "s"}`;
  }
  if (event.event_type === "source_authority_changed") {
    const to = text("authority");
    const from = text("from");
    const auto = meta.auto === true ? " (auto)" : "";
    if (!to) return null;
    return from ? `${from} → ${to}${auto}` : `→ ${to}${auto}`;
  }
  if (event.event_type === "identity_amended" && meta.changed && typeof meta.changed === "object") {
    const fields = Object.keys(meta.changed as Record<string, unknown>);
    return fields.length > 0 ? fields.join(", ") : null;
  }
  if (event.event_type === "api_key_created" || event.event_type === "api_key_revoked") {
    return text("label");
  }
  return null;
}

function Activity() {
  const router = useRouter();
  const navigate = useNavigate({ from: "/activity" });
  const { holder } = Route.useRouteContext();
  const filters = Route.useSearch();
  const { counts, log, types, failure } = Route.useLoaderData();

  const events = (log?.events ?? []) as unknown as EventRow[];
  const eventTypes = types as Array<{ eventType: string; count: number }>;

  return (
    <AppShell
      title="Activity"
      accession="Custody line"
      holder={holder}
      counts={counts}
      onSignOut={async () => {
        await authClient.signOut();
        router.navigate({ to: "/sign-in" });
      }}
    >
      <section className="log" aria-label="Activity log">
        <div className="filters filters--flush">
          <label className="filters__field">
            <span className="label">Event</span>
            <select
              value={filters.type ?? ""}
              onChange={(event) =>
                void navigate({ search: { type: event.target.value || undefined } })
              }
            >
              <option value="">All events</option>
              {eventTypes.map((entry) => (
                <option key={entry.eventType} value={entry.eventType}>
                  {phrase(entry.eventType)} · {entry.count}
                </option>
              ))}
            </select>
          </label>
        </div>

        {failure && (
          <p className="notice" role="alert">
            {failure}
          </p>
        )}

        {!failure && events.length === 0 && (
          <p className="empty prose">
            Nothing recorded yet. Every submission, revision, authority decision
            and credential change is written here as it happens.
          </p>
        )}

        {events.length > 0 && (
          <ul className="log__list">
            {events.map((event) => {
              const detail = detailOf(event);
              return (
                <li className="log__row" key={event.id}>
                  <time className="log__at register" dateTime={event.created_at}>
                    {stampAt(event.created_at)}
                  </time>
                  <span className="log__what">
                    {phrase(event.event_type)}
                    {detail && <span className="log__detail"> {detail}</span>}
                  </span>
                  {/* Omitted rather than emptied: a blank grid cell would add a
                      dead line once the columns stack on narrow screens. */}
                  {event.source_id && (
                    <span className="log__subject">
                      {event.source_title ? (
                        <Link to="/sources/$sourceId" params={{ sourceId: event.source_id }} search={{}}>
                          {event.source_title}
                        </Link>
                      ) : (
                        <span className="register">{accessionOf(event.source_id)}</span>
                      )}
                    </span>
                  )}
                  <span className="log__actor">
                    {event.actor_admin ?? event.actor_agent ?? (
                      <span className="log__unattributed">unattributed</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {log?.hasMore && (
          <p className="empty">
            Showing the {events.length} most recent entries. Filter by event to
            look further back.
          </p>
        )}
      </section>
    </AppShell>
  );
}
