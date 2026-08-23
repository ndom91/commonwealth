import { createFileRoute, Link } from '@tanstack/react-router';
import { AppShell, SealChip } from '../../../components/chrome.js';
import { Stamp } from '../../../components/stamp.js';
import { listReviewQueue } from '../../../lib/concepts.js';
import { readFailure } from '../../../lib/failure.js';
import { requireRole } from '../../../lib/route-guards.js';
import { documentTitle } from '../../../lib/title.js';

export const Route = createFileRoute('/p/$slug/review')({
  head: ({ match }) => ({
    meta: [{ title: documentTitle('Review queue', match.context.projectName) }],
  }),
  /* The `/p/$slug` layout has already resolved the project and confirmed
     membership; this only narrows by role. Approving what the corpus vouches
     for is a reviewer's job; a writer landing here would see a queue of buttons
     that all refuse.
     Enforced again in every server function this page calls. */
  beforeLoad: requireRole('review'),
  loader: async ({ params }) => {
    try {
      return {
        rows: await listReviewQueue({ data: { project: params.slug } }),
        failure: undefined,
      };
    } catch {
      return { rows: undefined, failure: readFailure('The queue') };
    }
  },
  component: Review,
});

type QueueRow = {
  path: string;
  type: string;
  authority: 'unverified' | 'approved' | 'canonical';
  last_verified_at: string | null;
  title: string;
  generated_at: string | null;
  is_unverified: boolean;
  is_stale: boolean;
};

function Review() {
  const viewer = Route.useRouteContext();
  const { rows: loaded, failure } = Route.useLoaderData();

  const rows = (loaded ?? []) as unknown as QueueRow[];
  const unverified = rows.filter((row) => row.is_unverified);
  const stale = rows.filter((row) => !row.is_unverified && row.is_stale);

  return (
    <AppShell title="Review queue" accession="Awaiting a human" {...viewer}>
      <section className="queue" aria-label="Review queue">
        {failure && (
          <p className="notice" role="alert">
            {failure}
          </p>
        )}

        {!failure && rows.length === 0 && (
          <p className="empty prose">
            Nothing is waiting. Every active source has been vouched for by a human, and none has
            changed since.
          </p>
        )}

        {unverified.length > 0 && (
          <QueueGroup
            label="Never verified"
            note="Submitted by an agent and not yet vouched for by anyone."
            rows={unverified}
          />
        )}

        {stale.length > 0 && (
          <QueueGroup
            label="Changed since verification"
            note="A human vouched for these, then an agent revised the content. Agents are being served text nobody has checked."
            rows={stale}
          />
        )}
      </section>
    </AppShell>
  );
}

function QueueGroup({ label, note, rows }: { label: string; note: string; rows: QueueRow[] }) {
  const { slug } = Route.useParams();
  return (
    <div className="queue__group">
      <div className="bench__section-head">
        <span className="label">
          {label} · {rows.length}
        </span>
      </div>
      {/* Not `.line__caption`. This sentence is the reason the queue exists —
          "Agents are being served text nobody has checked" — and it was set in
          the quietest style the product has, 12.5px in the most muted ink. A
          consequence should be legible at the weight of its consequence. */}
      <p className="queue__note">{note}</p>
      <ul className="index__list">
        {rows.map((row) => (
          <li key={row.path}>
            <Link
              to="/p/$slug/sources/$path"
              params={{ slug, path: row.path }}
              search={{}}
              className="entry"
            >
              <span className="entry__name">{row.title}</span>
              <span className="entry__accession">
                {row.type} · {row.path} · <Stamp at={row.generated_at} />
                {row.last_verified_at ? (
                  <>
                    {' · verified '}
                    <Stamp at={row.last_verified_at} />
                  </>
                ) : null}
              </span>
              <span className="entry__role">
                <SealChip state={row.is_unverified ? 'unsealed' : 'suspended'}>
                  {row.is_unverified ? 'Unverified' : 'Stale'}
                </SealChip>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
