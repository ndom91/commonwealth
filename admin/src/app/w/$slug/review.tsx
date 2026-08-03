import { createFileRoute, Link } from '@tanstack/react-router';
import { AppShell, accessionOf, SealChip } from '../../../components/chrome.js';
import { Stamp } from '../../../components/stamp.js';
import { readFailure } from '../../../lib/failure.js';
import { listReviewQueue } from '../../../lib/knowledge.js';
import { requireRole } from '../../../lib/route-guards.js';
import { documentTitle } from '../../../lib/title.js';

export const Route = createFileRoute('/w/$slug/review')({
  head: ({ match }) => ({
    meta: [{ title: documentTitle('Review queue', match.context.workspaceName) }],
  }),
  /* The `/w/$slug` layout has already resolved the workspace and confirmed
     membership; this only narrows by role. Approving what the corpus vouches
     for is a reviewer's job; a writer landing here would see a queue of buttons
     that all refuse.
     Enforced again in every server function this page calls. */
  beforeLoad: requireRole('review'),
  loader: async ({ params }) => {
    try {
      return {
        rows: await listReviewQueue({ data: { workspace: params.slug } }),
        failure: undefined,
      };
    } catch {
      return { rows: undefined, failure: readFailure('The queue') };
    }
  },
  component: Review,
});

type QueueRow = {
  id: string;
  source_type: 'note' | 'upload';
  authority: 'unverified' | 'approved' | 'canonical';
  created_at: string;
  last_verified_at: string | null;
  title: string;
  revision_number: number;
  content_updated_at: string;
  author: string | null;
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
          <li key={row.id}>
            <Link
              to="/w/$slug/sources/$sourceId"
              params={{ slug, sourceId: row.id }}
              search={{}}
              className="entry"
            >
              <span className="entry__name">{row.title}</span>
              <span className="entry__accession">
                {accessionOf(row.id)} · r{row.revision_number} ·{' '}
                <Stamp at={row.content_updated_at} />
                {row.author ? ` · ${row.author}` : ''}
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
