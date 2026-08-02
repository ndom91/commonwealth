import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { AppShell, accessionOf } from '../../../components/chrome.js';
import { day, Stamp, useMounted } from '../../../components/stamp.js';
import { readFailure } from '../../../lib/failure.js';
import { listEvents, listEventTypes } from '../../../lib/knowledge.js';

type ActivityFilters = { type?: string };

export const Route = createFileRoute('/w/$slug/activity')({
  validateSearch: (search: Record<string, unknown>): ActivityFilters => ({
    type:
      typeof search.type === 'string' && /^[a-z_]{1,64}$/.test(search.type)
        ? search.type
        : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, params }) => {
    try {
      const [log, types] = await Promise.all([
        listEvents({ data: { workspace: params.slug, eventType: deps.type } }),
        listEventTypes({ data: { workspace: params.slug } }),
      ]);
      return { log, types, failure: undefined };
    } catch {
      const types: Array<{ eventType: string; count: number }> = [];
      return { log: undefined, types, failure: readFailure('The log') };
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

/* The events that take something out of existence or out of service for good.
 *
 * Oxide is the mark for exactly that, and the custody line is the one register
 * where it recurs legitimately: each occurrence marks a real destruction, the same
 * way a struck `WITHDRAWN` repeats down the sources register. The Reserved Seal
 * Rule's two-place limit is about oxide spent on decoration, not about a log of
 * destructions declining to mark them.
 *
 * `identity_disabled` is absent from the list on purpose, but not
 * unconditionally. Disabling a holder by hand is reversible suspension, and the
 * seal vocabulary is careful to keep that distinct from a void. The same event
 * filed by `removePerson` is not reversible — it accompanies voided credentials
 * and the owner losing the workspace — so it carries `reason: 'offboarded'` and
 * is marked. A log that phrased the two identically would be describing a
 * suspension somebody could undo.
 *
 * `source_index_failed` is absent too: a failure is not a destruction, and its
 * own message already rides in the detail column. */
const DESTRUCTIVE = new Set([
  'api_key_revoked',
  'member_invitation_revoked',
  'member_removed',
  'source_deleted',
]);

/* Event types are stored as the verb the writer used. Rendering them raw would
   make the log read as a database dump, so each is given the sentence a person
   would say. Anything unmapped falls back to the raw type with underscores
   opened out — a new event type shows up legibly without a code change. */
const PHRASING: Record<string, string> = {
  source_submitted: 'Submitted a source',
  source_indexed: 'Finished indexing a source',
  source_index_failed: 'Failed to index a source',
  source_revised: 'Revised a source',
  source_authority_changed: 'Changed authority',
  source_deleted: 'Withdrew a source',
  source_restored: 'Restored a source',
  api_key_created: 'Issued a credential',
  api_key_revoked: 'Voided a credential',
  identity_amended: 'Amended a holder',
  identity_disabled: 'Disabled a holder',
  identity_enabled: 'Enabled a holder',
  member_invited: 'Invited someone',
  member_invitation_revoked: 'Revoked an invitation',
  member_joined: 'Joined the workspace',
  member_added: 'Added someone to the workspace',
  member_role_changed: 'Changed a role',
  member_removed: 'Removed someone',
  workspace_created: 'Created this workspace',
  workspace_renamed: 'Renamed the workspace',
  search: 'Searched',
};

const phrase = (type: string) => PHRASING[type] ?? type.replace(/_/g, ' ');

/* The one line of detail worth carrying on a log row. Everything else stays in
   the source bench or the holder bench, which have room for it. */
function detailOf(event: EventRow): string | null {
  const meta = event.metadata;
  const text = (key: string) => (typeof meta[key] === 'string' ? (meta[key] as string) : null);

  if (event.event_type === 'search') {
    const query = text('query');
    const count = typeof meta.resultCount === 'number' ? meta.resultCount : null;
    if (!query) return null;
    return count === null ? `“${query}”` : `“${query}” — ${count} result${count === 1 ? '' : 's'}`;
  }
  if (event.event_type === 'source_authority_changed') {
    const to = text('authority');
    const from = text('from');
    const auto = meta.auto === true ? ' (auto)' : '';
    if (!to) return null;
    return from ? `${from} → ${to}${auto}` : `→ ${to}${auto}`;
  }
  if (event.event_type === 'source_index_failed') {
    return text('message');
  }
  /* The pair that carry a `from` and a `to`, like an authority change — a
     rename is only legible as the two names together. */
  if (event.event_type === 'workspace_renamed') {
    const from = text('from');
    const to = text('to');
    return from && to ? `${from} → ${to}` : to;
  }
  if (event.event_type === 'source_indexed') {
    const count = typeof meta.chunkCount === 'number' ? meta.chunkCount : null;
    return count === null ? null : `${count} chunk${count === 1 ? '' : 's'}`;
  }
  if (event.event_type === 'identity_amended' && meta.changed && typeof meta.changed === 'object') {
    const fields = Object.keys(meta.changed as Record<string, unknown>);
    return fields.length > 0 ? fields.join(', ') : null;
  }
  if (event.event_type === 'api_key_created' || event.event_type === 'api_key_revoked') {
    return text('label');
  }
  /* Why this holder went out of service. Without it the log shows a disable
     nobody in the workspace performed, next to voids nobody ordered. */
  if (isOffboardingDisable(event)) {
    return 'owner removed from the workspace';
  }
  /* Who, and at what. A role change is the one event here where the old value
     matters as much as the new one — "reviewer → reader" is a withdrawal of
     trust, and reading it as just "reader" loses that. */
  if (event.event_type === 'member_role_changed') {
    const from = text('from');
    const to = text('to');
    if (!to) return null;
    return from ? `${from} → ${to}` : `→ ${to}`;
  }
  if (
    event.event_type === 'member_invited' ||
    event.event_type === 'member_added' ||
    event.event_type === 'member_joined'
  ) {
    const email = text('email');
    const role = text('role');
    if (!email) return null;
    return role ? `${email} as ${role}` : email;
  }
  if (event.event_type === 'member_invitation_revoked' || event.event_type === 'member_removed') {
    return text('email');
  }
  return null;
}

type DayGroup = { day: string; rows: EventRow[] };

/* One group per calendar day, newest first, preserving the order the rows arrive
 * in.
 *
 * The date was previously repeated in mono on every single row — `07/29`, `07/28`,
 * `07/28`, `07/27` down the whole column — which is a lot of ink to say "still the
 * same day". Heading each day once lets the rows carry only the time.
 *
 * `local` is threaded rather than assumed for the reason `day()` explains: the
 * server runs UTC, and grouping by local time during SSR would build a different
 * number of groups than the client, which is a structural hydration mismatch.
 *
 * A row whose timestamp will not parse is impossible — `created_at` is `NOT NULL`
 * — but it gets its own group rather than being dropped if it ever happens. The
 * log is append-only, and quietly losing a row from it would be the worst
 * available outcome. */
function groupByDay(events: EventRow[], local: boolean): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const event of events) {
    let key = day(event.created_at, local);
    if (!key) {
      key = '—';
    }
    const open = groups.at(-1);
    if (open && open.day === key) {
      open.rows.push(event);
      continue;
    }
    groups.push({ day: key, rows: [event] });
  }

  return groups;
}

// whatClass marks the verb column when the event it names destroyed something.
function whatClass(event: EventRow): string {
  if (DESTRUCTIVE.has(event.event_type) || isOffboardingDisable(event)) {
    return 'log__what log__what--void';
  }

  return 'log__what';
}

/* A holder disabled because its owner left, rather than by an administrator
   reaching for the button. Only the first is irreversible. */
function isOffboardingDisable(event: EventRow): boolean {
  return event.event_type === 'identity_disabled' && event.metadata.reason === 'offboarded';
}

function Activity() {
  const { slug } = Route.useParams();
  const navigate = useNavigate({ from: '/w/$slug/activity' });
  const viewer = Route.useRouteContext();
  const filters = Route.useSearch();
  const { log, types, failure } = Route.useLoaderData();

  const events = (log?.events ?? []) as unknown as EventRow[];
  const eventTypes = types as Array<{ eventType: string; count: number }>;
  /* Grouped by UTC day for the server render and the first client render, then
     regrouped in the reader's own timezone — see `day()`. */
  const mounted = useMounted();
  const groups = groupByDay(events, mounted);

  return (
    <AppShell title="Activity" accession="Custody line" {...viewer}>
      <section className="log" aria-label="Activity log">
        <div className="filters filters--flush">
          <label className="filters__field">
            <span className="label">Event</span>
            <select
              value={filters.type ?? ''}
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
            Nothing recorded yet. Every submission, revision, authority decision and credential
            change is written here as it happens.
          </p>
        )}

        {groups.map((group) => (
          <div className="log__group" key={group.day}>
            <span className="label log__day">{group.day}</span>
            <ul className="log__list">
              {group.rows.map((event) => {
                const detail = detailOf(event);
                return (
                  <li className="log__row" key={event.id}>
                    {/* Time only. The day is stated once, in the head above. */}
                    <Stamp at={event.created_at} precision="time" className="log__at register" />
                    <span className={whatClass(event)}>
                      {phrase(event.event_type)}
                      {detail && <span className="log__detail"> {detail}</span>}
                    </span>
                    {/* Omitted rather than emptied: a blank grid cell would add a
                        dead line once the columns stack on narrow screens. */}
                    {event.source_id && (
                      <span className="log__subject">
                        {event.source_title ? (
                          <Link
                            to="/w/$slug/sources/$sourceId"
                            params={{ slug, sourceId: event.source_id }}
                            search={{}}
                          >
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
          </div>
        ))}

        {log?.hasMore && (
          <p className="empty">
            Showing the {events.length} most recent entries. Filter by event to look further back.
          </p>
        )}
      </section>
    </AppShell>
  );
}
