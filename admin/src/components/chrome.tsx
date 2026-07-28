import * as Tooltip from '@radix-ui/react-tooltip';
import { Link } from '@tanstack/react-router';
import { type LucideIcon, UserRoundCog } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { can, type Role } from '../lib/roles.js';

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

type Mark = 'sources' | 'review' | 'identities' | 'people' | 'activity';

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
  /* A countersigned tag: the same issued-tag shape as identities, but with a
     signature line struck across it. People are the holders who sign for
     others rather than the ones being issued to. */
  if (mark === 'people')
    return (
      <svg {...common}>
        <path d="M1.8 2.6h7l3.4 2.4-3.4 2.4h-7z" />
        <path d="M2 10.6c1.6-1 3-1 4.2 0 1.2 1 2.8 1 4.4-.6" />
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

export type NavCounts = {
  identities: number;
  people: number;
  sources: number;
  review: number;
};

/* The rail shows a role only what that role can act on.
 *
 * A reader offered a Review queue that answers "Reviewer access is required" is
 * being told about a job that is not theirs, on every screen. Omitting the
 * drawer is the honest version: the section is not theirs to open.
 *
 * This is presentation, not protection. Every server function behind these
 * links calls `requireMember(permission, slug)` — see `lib/authorize.ts` — and
 * refuses regardless of what the rail happens to be showing.
 *
 * The role is the caller's role *in this workspace*. Someone may be an admin in
 * one and a reader in another, and the rail changes when they switch.
 *
 * Sections the MCP server already supports but the browser cannot reach yet
 * render dormant and marked PENDING. Linking them to routes that do not exist
 * would be a claim the product cannot honour. */
function drawerGroups(role: Role, counts: NavCounts | undefined): DrawerGroup[] {
  const groups: DrawerGroup[] = [
    {
      label: 'Knowledge',
      items: [
        { mark: 'sources', label: 'Sources', to: '/w/$slug/sources', count: counts?.sources },
        ...(can(role, 'review')
          ? [
              {
                mark: 'review' as const,
                label: 'Review queue',
                to: '/w/$slug/review',
                count: counts?.review,
              },
            ]
          : []),
      ],
    },
  ];
  /* Both halves of "who may act": the agent holders that present API keys, and
     the people who can sign in and decide what those agents are told. Both are
     credentials, so both are an administrator's business only. */
  if (can(role, 'admin')) {
    groups.push({
      label: 'Access',
      items: [
        {
          mark: 'identities',
          label: 'Identities',
          to: '/w/$slug/identities',
          count: counts?.identities,
        },
        { mark: 'people', label: 'People', to: '/w/$slug/people', count: counts?.people },
      ],
    });
  }
  groups.push({
    label: 'Custody',
    items: [{ mark: 'activity', label: 'Activity', to: '/w/$slug/activity' }],
  });
  return groups;
}

export type WorkspaceRef = { id: string; name: string; slug: string; role: Role };

/* The plate names the corpus you are in, and is how you leave it.
 *
 * It used to read "Team knowledge base / Custody bench" on every screen, which
 * was true and told you nothing. With more than one workspace the single most
 * important fact on the page is *which* one you are looking at — every count,
 * every register and every search below is scoped to it — so the plate says so
 * and the product name steps down to the sub-line.
 *
 * A `<details>` rather than a menu primitive: Radix's dropdown is not yet a
 * dependency and this is one list of links. `<details>` is keyboard-operable,
 * announces its own expanded state, and closes on Escape without any of that
 * being written here. A control this small should not add a dependency.
 *
 * With one workspace and no right to create another there is nothing to choose,
 * so it renders as a plain plate — no disclosure arrow promising a menu that
 * would open onto a list of one. */
function WorkspacePlate({
  slug,
  name,
  workspaces,
  canCreate,
}: {
  slug: string;
  name: string;
  workspaces: WorkspaceRef[];
  canCreate: boolean;
}) {
  const others = workspaces.filter((entry) => entry.slug !== slug);
  if (others.length === 0 && !canCreate) {
    return (
      <div className="cabinet__plate">
        <span>{name}</span>
        <small>Team knowledge base</small>
      </div>
    );
  }
  return (
    <details className="cabinet__switch">
      <summary className="cabinet__plate">
        <span>{name}</span>
        <small>Team knowledge base</small>
      </summary>
      <div className="cabinet__workspaces">
        {others.length > 0 && <span className="label">Switch to</span>}
        {others.map((entry) => (
          <Link
            key={entry.slug}
            to="/w/$slug/sources"
            params={{ slug: entry.slug }}
            search={{}}
            className="cabinet__workspace"
          >
            {entry.name}
            <span className="cabinet__workspace-role register">{entry.role}</span>
          </Link>
        ))}
        {canCreate && (
          <Link
            to="/w/$slug/people"
            params={{ slug }}
            hash="new-workspace"
            className="cabinet__workspace cabinet__workspace--new"
          >
            New workspace
          </Link>
        )}
      </div>
    </details>
  );
}

export function AppShell({
  title,
  accession,
  actions,
  holder,
  role,
  slug,
  workspaceName,
  workspaces,
  counts,
  onSignOut,
  children,
}: {
  title: string;
  accession?: string;
  actions?: ReactNode;
  holder?: string;
  /* Shapes the rail, and is the caller's role *in this workspace*. Supplied by
     the `/w/$slug` layout's `beforeLoad` alongside the holder name and the
     workspace list, so one round trip covers the whole shell. */
  role: Role;
  /* The workspace this page is showing. Every drawer link carries it, so
     switching section never silently changes corpus. */
  slug: string;
  workspaceName: string;
  workspaces: WorkspaceRef[];
  /* Read once by the `/w/$slug` layout and spread in with the rest of the
     viewer, not fetched here. Two reasons it is not component-local: the counts
     describe the workspace rather than the open page, and a fetch inside this
     component could not be reached by the bench that changes a source's
     authority — `router.invalidate()` re-runs the layout, so the rail moves
     with the pane that caused it. */
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
        <WorkspacePlate
          slug={slug}
          name={workspaceName}
          workspaces={workspaces}
          canCreate={can(role, 'admin')}
        />

        <nav className="drawers" aria-label="Sections">
          {drawerGroups(role, counts).map((group) => (
            <div className="drawer-group" key={group.label}>
              <span className="label">{group.label}</span>
              {group.items.map((item) =>
                item.to ? (
                  <Link
                    key={item.label}
                    to={item.to}
                    params={{ slug }}
                    search={{}}
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
                  to="/w/$slug/settings"
                  params={{ slug }}
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
