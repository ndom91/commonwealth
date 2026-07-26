import { type ComponentPropsWithoutRef, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";

/* Application chrome for the Custody Bench. Every workbench screen mounts
   inside AppShell and reuses the index-and-bench split: a ruled register of
   objects on the left, the selected object on the bench to its right. */

type Mark = "sources" | "review" | "identities" | "activity";

/* Marks are drawn in the world's own grammar — filing tabs, seals, tags and
   custody lines — rather than borrowed from a generic icon set. */
function DrawerMark({ mark }: { mark: Mark }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 14 14",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.25,
    "aria-hidden": true,
    className: "drawer__mark",
  } as const;
  if (mark === "sources")
    return (
      <svg {...common}>
        <path d="M1.5 3.5h4l1 1.5h6v6h-11z" />
        <path d="M1.5 6.5h11" />
      </svg>
    );
  if (mark === "review")
    return (
      <svg {...common}>
        <circle cx="7" cy="7" r="4.5" strokeDasharray="2 1.6" />
        <path d="M5 7.2 6.4 8.6 9 5.8" />
      </svg>
    );
  if (mark === "identities")
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
      label: "Knowledge",
      items: [
        { mark: "sources", label: "Sources", to: "/sources", count: counts?.sources },
        { mark: "review", label: "Review queue", to: "/review", count: counts?.review },
      ],
    },
    {
      label: "Access",
      items: [
        { mark: "identities", label: "Identities", to: "/identities", count: counts?.identities },
      ],
    },
    { label: "Custody", items: [{ mark: "activity", label: "Activity", to: "/activity" }] },
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
                    activeProps={{ "aria-current": "page" }}
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
                ),
              )}
            </div>
          ))}
        </nav>

        <div className="cabinet__foot">
          {holder && (
            <div className="cabinet__holder">
              <span className="label">Signed in</span>
              <b>{holder}</b>
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
export type SealState = "unsealed" | "signed" | "sealed" | "suspended" | "void";

export function SealChip({ state, children }: { state: SealState; children: ReactNode }) {
  return <span className={`chip chip--${state}`}>{children}</span>;
}

/* A control small enough to sit inside a field row, where a worded button would
   crowd out the field itself. The label is never dropped — it moves to the
   accessible name and the tooltip — so the control is still reachable by
   screen reader and still explains itself on hover.
 *
 * Icon-only is reserved for actions whose meaning is carried entirely by a
 * conventional glyph. Anything consequential keeps its word: a magnifier is
 * unambiguous, "withdraw" is not. */
export function IconButton({
  label,
  icon: Icon,
  tone = "quiet",
  ...button
}: {
  label: string;
  icon: LucideIcon;
  tone?: "quiet" | "void";
} & Omit<ComponentPropsWithoutRef<"button">, "children" | "className" | "aria-label" | "title">) {
  return (
    <button
      {...button}
      type={button.type ?? "button"}
      className={`icon-btn icon-btn--${tone}`}
      aria-label={label}
      title={label}
    >
      <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}

/* Source authority maps onto the seal vocabulary with no new states: an
   unverified source is unsealed, an approved one is signed, a canonical one is
   sealed. */
export function authoritySeal(authority: string): SealState {
  if (authority === "canonical") return "sealed";
  if (authority === "approved") return "signed";
  return "unsealed";
}

/* Records dates are rendered from the ISO string in UTC so the server and the
   client always agree, and so the column stays sortable by eye. */
export function stamp(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toISOString().slice(0, 10);
}

/* Same-day custody entries are common, so the line needs the clock as well as
   the date or its ordering cannot be checked by eye. */
export function stampAt(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)}`;
}

/* An accession is a short, stable handle derived from the record's own id;
   nothing is invented. */
export function accessionOf(id: string): string {
  return id.replace(/-/g, "").slice(0, 8).toUpperCase();
}
