import { createFileRoute, Link } from '@tanstack/react-router';
import { Stamp } from '../../../../components/stamp.js';
import { getRegisterSummary } from '../../../../lib/concepts.js';
import { readFailure } from '../../../../lib/failure.js';

/* What the bench holds while no source is selected.
 *
 * This is the most frequently seen state of the surface where the recurring job
 * happens, and it used to be one sentence — twelve words telling you to click
 * something — in a pane 784px wide by 793px tall. Just under half the viewport,
 * saying nothing a reader did not already know from looking at the register beside
 * it.
 *
 * So it states the corpus in custody terms instead. Not a dashboard: no tiles, no
 * hero figure, no chart. A ruled standing, label and register value, the way a
 * custody form records a holding — and one sentence of consequence at the top when
 * something is actually owed a human, because that is the only part a reader must
 * not skim past.
 *
 * Every count here is one the rail does *not* carry. The register's own size is
 * stated once, in the navigation that owns it. */
export const Route = createFileRoute('/w/$slug/sources/')({
  loader: async ({ params }) => {
    try {
      return { standing: await getRegisterSummary({ data: { workspace: params.slug } }) };
    } catch {
      return { standing: undefined, failure: readFailure('The corpus') };
    }
  },
  component: Standing,
});

type Custody = {
  unverified: number;
  stale: number;
  canonical: number;
  withdrawn: number;
  chunks: number;
  lastVerified: string | null;
  lastRetrieved: string | null;
};

/* The sentence at the top, and the reason this pane is worth its width.
 *
 * Wording follows the review queue's two populations, because they are the same
 * two and a reader should meet one description of them. Returns null when nothing
 * is owed — an empty queue needs no banner, and inventing reassurance to fill the
 * space would be exactly the decoration this replaces. */
function owed(standing: Custody): string | null {
  if (standing.unverified > 0 && standing.stale > 0) {
    return `${standing.unverified} ${sources(standing.unverified)} nobody has vouched for, and ${standing.stale} that changed after somebody did. Agents are being served all of it.`;
  }
  if (standing.unverified > 0) {
    return `${standing.unverified} ${sources(standing.unverified)} submitted by an agent and not yet vouched for by anyone. Agents are being served ${them(standing.unverified)}.`;
  }
  if (standing.stale > 0) {
    return `${standing.stale} ${sources(standing.stale)} a human vouched for and an agent then revised. Agents are being served text nobody has checked.`;
  }

  return null;
}

// sources agrees the noun with its count.
function sources(count: number): string {
  if (count === 1) {
    return 'source';
  }

  return 'sources';
}

// them agrees the pronoun with its count.
function them(count: number): string {
  if (count === 1) {
    return 'it';
  }

  return 'them';
}

function Standing() {
  const { slug } = Route.useParams();
  const { standing, failure } = Route.useLoaderData();

  if (failure || !standing) {
    return (
      <section className="detail" aria-label="The corpus">
        <p className="notice" role="alert">
          {failure}
        </p>
      </section>
    );
  }

  const attention = owed(standing);

  return (
    <section className="detail" aria-label="The corpus">
      <div className="standing">
        <span className="label">In custody</span>

        {attention && (
          <p className="standing__owed">
            {attention}{' '}
            <Link to="/w/$slug/review" params={{ slug }}>
              Work the queue
            </Link>
          </p>
        )}
        {!attention && (
          <p className="standing__owed standing__owed--clear">
            Every active source has been vouched for by a human, and none has changed since.
          </p>
        )}

        <dl className="standing__rows">
          <div className="standing__row">
            <dt className="label">Sealed canonical</dt>
            <dd className="register">{standing.canonical}</dd>
          </div>
          {/* The two populations owed a human, kept apart. Their sum is the number
              on the rail's review drawer, so stating the sum here would repeat it;
              the split is what the rail cannot say. */}
          <div className="standing__row">
            <dt className="label">Never vouched for</dt>
            <dd className="register">{standing.unverified}</dd>
          </div>
          <div className="standing__row">
            <dt className="label">Changed since vouched</dt>
            <dd className="register">{standing.stale}</dd>
          </div>
          <div className="standing__row">
            <dt className="label">Withdrawn</dt>
            <dd className="register">{standing.withdrawn}</dd>
          </div>
          {/* What agents are actually served is chunks, not sources — a register of
              eleven documents can be two hundred passages, and the passage is the
              unit retrieval returns. */}
          <div className="standing__row">
            <dt className="label">Passages indexed</dt>
            <dd className="register">{standing.chunks}</dd>
          </div>
          <div className="standing__row">
            <dt className="label">Last vouched for</dt>
            <dd className="register">
              <Stamp at={standing.lastVerified} />
            </dd>
          </div>
          {/* The one fact here that comes from the agents rather than from the
              people: when this corpus was last actually used. A knowledge base
              nobody retrieves from is a different problem from one nobody
              curates. */}
          <div className="standing__row">
            <dt className="label">Last retrieved</dt>
            <dd className="register">
              <Stamp at={standing.lastRetrieved} precision="datetime" />
            </dd>
          </div>
        </dl>

        <p className="standing__hint">
          Select a source from the register to read it, inspect its revisions, and set its
          authority.
        </p>
      </div>
    </section>
  );
}
