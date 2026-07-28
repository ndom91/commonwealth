import * as Tooltip from '@radix-ui/react-tooltip';
import { Link, useRouter } from '@tanstack/react-router';
import { type LucideIcon, UserRoundCog } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { authClient } from '../lib/auth-client.js';
import { can, type Role, type WorkspaceRef } from '../lib/roles.js';

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

type Mark = 'sources' | 'review' | 'identities' | 'people' | 'settings' | 'activity';

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
  /* The cabinet front rather than a drawer within it: a case with two drawer
     faces and their pulls. Settings configures the thing that holds the
     drawers, so it is drawn as the object and not as one more index. A cog
     would have been the reflex and would have been the only borrowed shape in
     the rail. */
  if (mark === 'settings')
    return (
      <svg {...common}>
        <rect x="1.8" y="2.2" width="10.4" height="9.6" rx="0.5" />
        <path d="M1.8 7h10.4" />
        <path d="M5.8 4.6h2.4M5.8 9.4h2.4" />
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
  /* Who may act — the people who can sign in and the agent holders that present
     API keys — used to be an Access group here as well as tabs of Settings. Two
     ways into one page reads as indecision, not convenience: the same two words
     twice on one screen, and either one landing you somewhere that shows both.
     The tabs won, and took the counts with them, so a register's size is still
     stated exactly once in the navigation that owns it. */
  if (can(role, 'admin')) {
    groups.push({
      label: 'Workspace',
      items: [{ mark: 'settings', label: 'Settings', to: '/w/$slug/settings/workspace' }],
    });
  }
  groups.push({
    label: 'Custody',
    items: [{ mark: 'activity', label: 'Activity', to: '/w/$slug/activity' }],
  });
  return groups;
}

/* The plate names the corpus you are in, and is how you leave it.
 *
 * It used to read the product name over "Custody bench" on every screen, which
 * was true and told you nothing. With more than one workspace the single most
 * important fact on the page is *which* one you are looking at — every count,
 * every register and every search below is scoped to it — so the plate says so
 * and the product name steps down to the sub-line.
 *
 * A `<details>` rather than a menu primitive: Radix's dropdown is not yet a
 * dependency and this is one list of links. `<details>` is keyboard-operable
 * and announces its own expanded state without any of that being written here.
 * It does *not* close on Escape or on an outside click — see the note in the
 * stylesheet for why that is survivable here and would not be for a menu that
 * floated over the rail.
 *
 * Switching only. Creating a workspace used to hang off the bottom of this menu
 * and deep-link into a form on the People page; it lives in Settings now, which
 * has a drawer of its own. So the plate is a disclosure exactly when there is
 * somewhere to go, and a plain plate otherwise — no arrow promising a menu that
 * would open onto a list of one. */
function WorkspacePlate({
  slug,
  name,
  workspaces,
}: {
  slug: string;
  name: string;
  workspaces: WorkspaceRef[];
}) {
  const others = workspaces.filter((entry) => entry.slug !== slug);
  if (others.length === 0) {
    return (
      <div className="cabinet__plate">
        <span>{name}</span>
        <small>Commonwealth</small>
      </div>
    );
  }
  return (
    <details className="cabinet__switch">
      <summary className="cabinet__plate">
        <span>{name}</span>
        <small>Commonwealth</small>
      </summary>
      <div className="cabinet__workspaces">
        <span className="label">Switch to</span>
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
      </div>
    </details>
  );
}

export function AppShell({
  title,
  accession,
  actions,
  tabs,
  holder,
  role,
  slug,
  workspaceName,
  workspaces,
  counts,
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
  /* A section that has more than one face puts its faces here — see
     `SettingsTabs`. Rendered by the shell rather than by each page so the bar
     is in the same place, with the same rule under it, on every tab; passed by
     each page rather than owned by a layout route so a tab keeps its own title
     and its own masthead action. */
  tabs?: ReactNode;
  children: ReactNode;
}) {
  /* Signing out is chrome behaviour, not page behaviour. Seven routes used to
     pass an identical handler in, which meant seven places to find if it ever
     needed to do more than this. */
  const router = useRouter();
  const signOut = async () => {
    await authClient.signOut();
    router.navigate({ to: '/sign-in' });
  };
  return (
    <div className="custody">
      {/* The cabinet puts its plate and four drawer links ahead of the page's
          own content, on every route. Without this a keyboard user re-traverses
          the whole rail after each navigation. */}
      <a className="skip" href="#main">
        Skip to content
      </a>

      <aside className="cabinet">
        <WorkspacePlate slug={slug} name={workspaceName} workspaces={workspaces} />

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
              {/* Your account sits with the signed-in name rather than in a
                  drawer: it is a preference, not a section of the corpus. The
                  workspace's own settings are a drawer, because they are.
                 *
                  A Lucide glyph, like the other icon-only controls — the
                  hand-drawn marks are the drawer vocabulary, not this one.
                  `user-round-cog` rather than a bare cog: a lone gear beside a
                  name reads as app configuration, and a gear drawn small enough
                  to fit reads as a sun. The person makes it unmistakably
                  *your account*. Label moves to `aria-label` and the hint per
                  the Icon Button rule. */}
              <Hint label="Account">
                <Link
                  to="/w/$slug/account"
                  params={{ slug }}
                  className="icon-btn"
                  aria-label="Account"
                  activeProps={{ 'aria-current': 'page' }}
                >
                  <UserRoundCog size={15} strokeWidth={1.75} aria-hidden="true" />
                </Link>
              </Hint>
            </div>
          )}
          <button type="button" className="btn btn--quiet" onClick={signOut}>
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
        {tabs}
        {children}
      </main>
    </div>
  );
}

/* The three faces of Settings.
 *
 * A `<nav>` of links, not an ARIA `tablist`. These are routes: they are in
 * history, the browser's Back moves between them, and one can be pasted to a
 * colleague. `tablist` would describe panels swapped in place and would take
 * arrow-key navigation away from a set of links that ought to Tab like links.
 *
 * The two registers state their size here. That rule — a size appears once, in
 * the navigation that owns the register — used to name the rail, because the
 * rail was the only navigation there was. These two left it, so this bar is
 * their navigation and the numbers came along. Workspace gets none: it is not a
 * register. Nor does either page repeat its own count in a head.
 *
 * `activeOptions.exact` is off for Identities on purpose: a selected holder
 * lives at `settings/identities/$id`, and the tab has to stay lit while you are
 * reading one. */
export function SettingsTabs({ slug, counts }: { slug: string; counts: NavCounts | undefined }) {
  return (
    <nav className="tabs" aria-label="Settings sections">
      <Link
        to="/w/$slug/settings/workspace"
        params={{ slug }}
        className="tabs__link"
        activeProps={{ 'aria-current': 'page' }}
      >
        Workspace
      </Link>
      <Link
        to="/w/$slug/settings/people"
        params={{ slug }}
        className="tabs__link"
        activeProps={{ 'aria-current': 'page' }}
      >
        People
        <Count value={counts?.people} />
      </Link>
      <Link
        to="/w/$slug/settings/identities"
        params={{ slug }}
        search={{}}
        className="tabs__link"
        activeProps={{ 'aria-current': 'page' }}
      >
        Identities
        <Count value={counts?.identities} />
      </Link>
    </nav>
  );
}

/* A count is omitted rather than shown as a dash while it is unknown: the rail
   does the same, and a tab that reads "People —" for a moment invites the reader
   to wonder what that means about the register. */
function Count({ value }: { value: number | undefined }) {
  if (value === undefined) return null;
  return <span className="tabs__count register">{value}</span>;
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
