import * as Tooltip from '@radix-ui/react-tooltip';
import { Link } from '@tanstack/react-router';
import { type LucideIcon, UserRoundCog } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

/* Application chrome for the Custody Bench. Every workbench screen mounts
   inside AppShell and reuses the index-and-bench split: a ruled register of
   objects on the left, the selected object on the bench to its right. */

/* The label of an icon-only control, made visible on hover.
 *
 * Distinct from the tooltip on a timestamp, which supplies information that is
 * not otherwise on screen and so belongs in `aria-describedby`. Here the
 * tooltip only shows what the control is *already called* — the trigger keeps
 * its own `aria-label`, which is what a screen reader announces.
 *
 * Hence the `aria-hidden` wrapper. Radix points the trigger's
 * `aria-describedby` at this content; without it the same word is announced
 * twice, once as the name and once as the description. Hiding the subtree makes
 * the computed description empty and leaves the name alone. */
function Hint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tip tip--label" sideOffset={6} collisionPadding={8}>
          <span aria-hidden="true">{label}</span>
          <Tooltip.Arrow className="tip__arrow" width={9} height={4} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

type Mark = 'sources' | 'review' | 'identities' | 'activity';

/* Marks are drawn in the world's own grammar — filing tabs, seals, tags and
   custody lines — rather than borrowed from a generic icon set. */
function DrawerMark({ mark }: { mark: Mark }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 14 14',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.25,
    'aria-hidden': true,
    className: 'drawer__mark',
  } as const;
  if (mark === 'sources')
    return (
      <svg {...common}>
        <path d="M1.5 3.5h4l1 1.5h6v6h-11z" />
        <path d="M1.5 6.5h11" />
      </svg>
    );
  if (mark === 'review')
    return (
      <svg {...common}>
        <circle cx="7" cy="7" r="4.5" strokeDasharray="2 1.6" />
        <path d="M5 7.2 6.4 8.6 9 5.8" />
      </svg>
    );
  if (mark === 'identities')
    return (
      <svg {...common}>
        <path d="M2 4.2h6l4 2.8-4 2.8H2z" />
        <circle cx="4.4" cy="7" r="0.9" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M3.5 1.8v10.4" />
      <path d="M3.5 4h7M3.5 7h5M3.5 10h8" />
    </svg>
  );
}

type Drawer = { mark: Mark; label: string; to?: string; count?: number };
type DrawerGroup = { label: string; items: Drawer[] };

export type NavCounts = { identities: number; sources: number; review: number };

/* Sections the MCP server already supports but the browser cannot reach yet
   render dormant and marked PENDING. Linking them to routes that do not exist
   would be a claim the product cannot honour. */
function drawerGroups(counts: NavCounts | undefined): DrawerGroup[] {
  return [
    {
      label: 'Knowledge',
      items: [
        { mark: 'sources', label: 'Sources', to: '/sources', count: counts?.sources },
        { mark: 'review', label: 'Review queue', to: '/review', count: counts?.review },
      ],
    },
    {
      label: 'Access',
      items: [
        { mark: 'identities', label: 'Identities', to: '/identities', count: counts?.identities },
      ],
    },
    { label: 'Custody', items: [{ mark: 'activity', label: 'Activity', to: '/activity' }] },
  ];
}

export function AppShell({
  title,
  accession,
  actions,
  holder,
  counts,
  onSignOut,
  children,
}: {
  title: string;
  accession?: string;
  actions?: ReactNode;
  holder?: string;
  /* Supplied by each route's loader rather than fetched here, so that
     `router.invalidate()` after a mutation moves the rail as well as the pane
     that caused it. A component-local fetch could not be reached from the
     bench that changes a source's authority. */
  counts: NavCounts | undefined;
  onSignOut: () => void;
  children: ReactNode;
}) {
  return (
    <div className="custody">
      {/* The cabinet puts its plate and four drawer links ahead of the page's
          own content, on every route. Without this a keyboard user re-traverses
          the whole rail after each navigation. */}
      <a className="skip" href="#main">
        Skip to content
      </a>

      <aside className="cabinet">
        <Link to="/identities" className="cabinet__plate">
          <span>Team knowledge base</span>
          <small>Custody bench</small>
        </Link>

        <nav className="drawers" aria-label="Sections">
          {drawerGroups(counts).map((group) => (
            <div className="drawer-group" key={group.label}>
              <span className="label">{group.label}</span>
              {group.items.map((item) =>
                item.to ? (
                  <Link
                    key={item.label}
                    to={item.to}
                    className="drawer"
                    activeProps={{ 'aria-current': 'page' }}
                  >
                    <DrawerMark mark={item.mark} />
                    {item.label}
                    {item.count !== undefined && (
                      <span className="drawer__count">{item.count}</span>
                    )}
                  </Link>
                ) : (
                  <button
                    key={item.label}
                    type="button"
                    className="drawer drawer--dormant"
                    disabled
                  >
                    <DrawerMark mark={item.mark} />
                    {item.label}
                    <span className="sr-only">
                      — available over MCP, not yet reachable from the browser
                    </span>
                    <span className="drawer__count">Pending</span>
                  </button>
                )
              )}
            </div>
          ))}
        </nav>

        <div className="cabinet__foot">
          {holder && (
            <div className="cabinet__identity">
              <div className="cabinet__holder">
                <span className="label">Signed in</span>
                <b>{holder}</b>
              </div>
              {/* Settings sits with the signed-in name rather than in a drawer:
                  it is your account and who else holds one, not a section of
                  the corpus.
                 *
                  A Lucide glyph, like the other icon-only controls — the
                  hand-drawn marks are the drawer vocabulary, not this one.
                  `user-round-cog` rather than a bare cog: a lone gear beside a
                  name reads as app configuration, and a gear drawn small enough
                  to fit reads as a sun. The person makes it unmistakably
                  *your account*. Label moves to `aria-label` and the hint per
                  the Icon Button rule. */}
              <Hint label="Settings">
                <Link
                  to="/settings"
                  className="icon-btn"
                  aria-label="Settings"
                  activeProps={{ 'aria-current': 'page' }}
                >
                  <UserRoundCog size={15} strokeWidth={1.75} aria-hidden="true" />
                </Link>
              </Hint>
            </div>
          )}
          <button type="button" className="btn btn--quiet" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </aside>

      {/* A real landmark, not a styled div: every page behind auth had none, so
          screen-reader users had no main region to jump to. `tabIndex={-1}`
          makes the skip link move focus here rather than only scrolling — the
          difference between the link working and appearing to work. */}
      <main className="main" id="main" tabIndex={-1}>
        <header className="masthead">
          <div>
            {accession && <span className="label">{accession}</span>}
            <h1>{title}</h1>
          </div>
          {actions && <div className="masthead__actions">{actions}</div>}
        </header>
        {children}
      </main>
    </div>
  );
}

/* Seal state escalates by material commitment rather than by hue: unsealed is
   a dashed outline, signed is a solid outline, sealed is filled oxide, a
   suspended object is outlined in oxide but intact, and a voided one is struck
   through yet never removed. */
export type SealState = 'unsealed' | 'signed' | 'sealed' | 'suspended' | 'void';

export function SealChip({ state, children }: { state: SealState; children: ReactNode }) {
  return <span className={`chip chip--${state}`}>{children}</span>;
}

/* A control small enough to sit inside a field row, where a worded button would
   crowd out the field itself. The label is never dropped — it stays the
   accessible name and appears on hover through `Hint` — so the control is
   still reachable by screen reader and still explains itself.
 *
 * Icon-only is reserved for actions whose meaning is carried entirely by a
 * conventional glyph. Anything consequential keeps its word: a magnifier is
 * unambiguous, "withdraw" is not. */
export function IconButton({
  label,
  icon: Icon,
  tone = 'quiet',
  ...button
}: {
  label: string;
  icon: LucideIcon;
  tone?: 'quiet' | 'void';
} & Omit<ComponentPropsWithoutRef<'button'>, 'children' | 'className' | 'aria-label' | 'title'>) {
  return (
    <Hint label={label}>
      <button
        {...button}
        type={button.type ?? 'button'}
        className={`icon-btn icon-btn--${tone}`}
        aria-label={label}
      >
        <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </Hint>
  );
}

/* Source authority maps onto the seal vocabulary with no new states: an
   unverified source is unsealed, an approved one is signed, a canonical one is
   sealed. */
export function authoritySeal(authority: string): SealState {
  if (authority === 'canonical') return 'sealed';
  if (authority === 'approved') return 'signed';
  return 'unsealed';
}

/* Timestamps live in `components/stamp.tsx`. They used to be two functions
   here returning UTC strings, which kept the server and client in agreement but
   meant nobody could read the time in their own timezone. `<Stamp>` shows local
   time and puts the UTC instant in a tooltip; it is a component rather than a
   function because the tooltip needs an element to hang on.

   Nothing should render a date without it — a bare `toISOString().slice()`
   anywhere in a route is a timestamp that silently reads UTC to a reader who is
   not in it. */

/* An accession is a short, stable handle derived from the record's own id;
   nothing is invented. */
export function accessionOf(id: string): string {
  return id.replace(/-/g, '').slice(0, 8).toUpperCase();
}
