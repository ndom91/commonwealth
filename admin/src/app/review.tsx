import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router';
import { AppShell, accessionOf, SealChip } from '../components/chrome.js';
import { Stamp } from '../components/stamp.js';
import { authClient } from '../lib/auth-client.js';
import { getNavCounts, listReviewQueue } from '../lib/knowledge.js';
import { readFailure } from '../lib/read-failure.js';
import { getSession } from '../lib/session.js';

export const Route = createFileRoute('/review')({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session) throw redirect({ to: '/sign-in' });
    return { holder: session.user.name ?? session.user.email ?? undefined };
  },
  loader: async () => {
    const counts = await getNavCounts().catch(() => undefined);
    try {
      return { counts, rows: await listReviewQueue(), failure: undefined };
    } catch (cause) {
      return { counts, rows: undefined, failure: readFailure(cause, 'The queue') };
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
  const router = useRouter();
  const { holder } = Route.useRouteContext();
  const { counts, rows: loaded, failure } = Route.useLoaderData();

  const rows = (loaded ?? []) as unknown as QueueRow[];
  const unverified = rows.filter((row) => row.is_unverified);
  const stale = rows.filter((row) => !row.is_unverified && row.is_stale);

  return (
    <AppShell
      title="Review queue"
      accession="Awaiting a human"
      holder={holder}
      counts={counts}
      onSignOut={async () => {
        await authClient.signOut();
        router.navigate({ to: '/sign-in' });
      }}
    >
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
  return (
    <div className="queue__group">
      <div className="bench__section-head">
        <span className="label">
          {label} · {rows.length}
        </span>
      </div>
      <p className="line__caption queue__note">{note}</p>
      <ul className="index__list">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              to="/sources/$sourceId"
              params={{ sourceId: row.id }}
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
