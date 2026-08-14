import { createFileRoute, Link, Outlet, useNavigate } from '@tanstack/react-router';
import { Search, X } from 'lucide-react';
import { AppShell, authoritySeal, IconButton, SealChip } from '../../../components/chrome.js';
import { Stamp } from '../../../components/stamp.js';
import { listConcepts, searchConcepts } from '../../../lib/concepts.js';
import { readFailure } from '../../../lib/failure.js';
import { documentTitle } from '../../../lib/title.js';

export type SourceFilters = {
  authority?: 'unverified' | 'approved' | 'canonical';
  type?: string;
  q?: string;
};

function highlight(excerpt: string) {
  return excerpt.split('\u0002').flatMap((chunk, index) => {
    const [matched, rest] = chunk.split('\u0003');
    return index === 0
      ? [<span key={index}>{chunk}</span>]
      : [<mark key={`m${index}`}>{matched}</mark>, <span key={index}>{rest ?? ''}</span>];
  });
}

export const Route = createFileRoute('/w/$slug/sources')({
  validateSearch: (search: Record<string, unknown>): SourceFilters => ({
    authority: ['unverified', 'approved', 'canonical'].includes(String(search.authority))
      ? (search.authority as SourceFilters['authority'])
      : undefined,
    type: typeof search.type === 'string' && search.type.trim() ? search.type.trim() : undefined,
    q: typeof search.q === 'string' && search.q.trim() ? search.q.trim().slice(0, 200) : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, params }) => {
    try {
      const sources = deps.q
        ? await searchConcepts({
            data: {
              workspace: params.slug,
              authority: deps.authority,
              type: deps.type,
              query: deps.q,
            },
          })
        : await listConcepts({
            data: { workspace: params.slug, authority: deps.authority, type: deps.type },
          });
      return { register: { sources, hasMore: false }, failure: undefined };
    } catch {
      return { register: undefined, failure: readFailure('The register') };
    }
  },
  head: ({ match }) => ({
    meta: [{ title: documentTitle('Concepts', match.context.workspaceName) }],
  }),
  component: Sources,
});

type ConceptRow = {
  path: string;
  commit_sha: string;
  type: string;
  title: string | null;
  tags: string[];
  authority: 'unverified' | 'approved' | 'canonical';
  generated_at: string | null;
  excerpt?: string;
};

function Sources() {
  const { slug } = Route.useParams();
  const navigate = useNavigate({ from: '/w/$slug/sources' });
  const viewer = Route.useRouteContext();
  const filters = Route.useSearch();
  const { register, failure } = Route.useLoaderData();
  const concepts = (register?.sources ?? []) as unknown as ConceptRow[];
  const searching = Boolean(filters.q);
  const narrowed = Boolean(filters.authority || filters.type);
  const setFilter = (key: keyof SourceFilters, value: string) =>
    void navigate({
      search: (previous: SourceFilters) => ({ ...previous, [key]: value || undefined }),
    });

  return (
    <AppShell
      title="Concepts"
      accession="Knowledge register"
      {...viewer}
      actions={
        <Link to="/w/$slug/sources/new" search={{}} className="btn btn--primary">
          New concept
        </Link>
      }
    >
      <div className="panes">
        <section className="index" aria-label="Concept register">
          <form
            className="seek"
            onSubmit={(event) => {
              event.preventDefault();
              const value = new FormData(event.currentTarget).get('q');
              void navigate({
                search: (previous: SourceFilters) => ({
                  ...previous,
                  q: typeof value === 'string' && value.trim() ? value.trim() : undefined,
                }),
              });
            }}
          >
            <label className="seek__field">
              <span className="label">Keyword search</span>
              <input
                key={filters.q ?? ''}
                name="q"
                type="search"
                defaultValue={filters.q ?? ''}
                placeholder="Words in the concept"
                autoComplete="off"
              />
            </label>
            <IconButton type="submit" label="Search" icon={Search} />
            {searching && (
              <IconButton
                label="Clear search"
                icon={X}
                onClick={() =>
                  void navigate({
                    search: (previous: SourceFilters) => ({ ...previous, q: undefined }),
                  })
                }
              />
            )}
          </form>
          <div className="filters">
            <label className="filters__field">
              <span className="label">Authority</span>
              <select
                value={filters.authority ?? ''}
                onChange={(event) => setFilter('authority', event.target.value)}
              >
                <option value="">All</option>
                <option value="unverified">Unverified</option>
                <option value="approved">Approved</option>
                <option value="canonical">Canonical</option>
              </select>
            </label>
            <label className="filters__field">
              <span className="label">Type</span>
              <input
                value={filters.type ?? ''}
                onChange={(event) => setFilter('type', event.target.value)}
                placeholder="Playbook"
              />
            </label>
          </div>
          {failure && (
            <p className="notice index__note" role="alert">
              {failure}
            </p>
          )}
          {!failure && concepts.length === 0 && (
            <p className="empty index__note">
              {searching ? (
                'No concept title or body matches. Try fewer words, or clear the search to browse the register.'
              ) : narrowed ? (
                'No concepts match these filters. Widen one, or set them back to All.'
              ) : (
                <>
                  The register is empty. Create a concept here or use MCP{' '}
                  <code className="register">create_concept</code>.
                </>
              )}
            </p>
          )}
          <ul className="index__list">
            {concepts.map((concept) => (
              <li key={concept.path}>
                <Link
                  to="/w/$slug/sources/$path"
                  params={{ slug, path: concept.path }}
                  search={filters}
                  className="entry"
                  activeProps={{ 'aria-current': 'page' }}
                >
                  <span className="entry__name">{concept.title ?? concept.path}</span>
                  <span className="entry__accession">
                    {concept.type} · {concept.path} · <Stamp at={concept.generated_at} />
                  </span>
                  {concept.excerpt && (
                    <span className="entry__excerpt">{highlight(concept.excerpt)}</span>
                  )}
                  {concept.authority !== 'approved' && (
                    <span className="entry__role">
                      <SealChip state={authoritySeal(concept.authority)}>
                        {concept.authority}
                      </SealChip>
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <Outlet />
      </div>
    </AppShell>
  );
}
