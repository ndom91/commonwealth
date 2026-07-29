import * as Tooltip from '@radix-ui/react-tooltip';
import { useEffect, useState } from 'react';

/* Every timestamp in the product, rendered once.
 *
 * Two readings of the same instant: the page shows it in the reader's own
 * timezone and locale, and hovering shows the ISO 8601 instant in UTC — the
 * value the database actually holds, and the one to quote in a bug report. A
 * custody register is a record of when things happened; "26 July" meaning two
 * different moments to two people in different offices is exactly the ambiguity
 * this removes. */

/* The one place a timestamp becomes a string this app is willing to reason
   about.
 *
 * `drizzle()` mutates the shared postgres.js client's date parsers as well as
 * its jsonb serializer (see `lib/db.ts`), so `timestamptz` arrives here as raw
 * Postgres text — `2026-07-24 16:30:00.313448+00` — rather than a Date. That
 * is not ISO 8601: a space where the `T` belongs and a two-digit offset. Both
 * V8 and JavaScriptCore happen to read it correctly today, but `Date.parse` on
 * non-ISO input is implementation-defined in ECMA-262, and a parser that
 * decided to treat it as local time instead would put every timestamp in the
 * product out by the reader's own offset without erroring once.
 *
 * So normalise rather than trust. A Date passes through (a bare postgres.js
 * client, or anything constructed in JS); a string is repaired into real ISO;
 * anything unparseable becomes null rather than the silent `Invalid Date` that
 * would render as a dash and look like missing data. */
export function isoUtc(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const repaired = value.trim().replace(' ', 'T');
  /* A zone-less date-time is local time under ES2015+, which for a column that
     is `timestamptz` on both sides would be simply wrong. Every value reaching
     here is UTC, so say so rather than let the engine guess. */
  const zoned = /(Z|[+-]\d{2}(:?\d{2})?)$/.test(repaired) ? repaired : `${repaired}Z`;
  /* `+00` is a valid Postgres offset and an invalid ISO 8601 one. */
  const widened = zoned.replace(/([+-]\d{2})$/, '$1:00');
  const parsed = new Date(widened);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/* Built once. `Intl.DateTimeFormat` construction is the expensive part of
   formatting, and the register builds dozens of these per paint.
 *
 * Two-digit numeric rather than `dateStyle: 'medium'`: DESIGN.md sets
 * timestamps in the register face, which is mono with `tabular-nums` so a
 * column of figures lines up. "Jul 27, 2026" has a variable-width month and
 * defeats that; "27.07.2026" — still the reader's own locale — does not. */
const localDate = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const localDateTime = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/* For a row that sits under a date head and so only needs to say when in the
   day it happened. */
const localTime = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});

/* These routes are server-rendered — /sources alone ships 52 timestamps in its
   HTML — and the container runs UTC while the reader does not. Formatting in
   local time during SSR would produce markup the client disagrees with.
 *
 * So the server and the first client render both emit the UTC form, which is
 * what this app displayed before and is identical on both sides by
 * construction; local formatting arrives on the second render. The cost is a
 * brief flicker on the timestamps where the two differ, which beats a
 * hydration mismatch or a layout shift from rendering nothing until mount. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/* How much of an instant a stamp shows. `time` is for rows already grouped under
   a date, where repeating the date on every one of them is the noise the grouping
   exists to remove. */
export type StampPrecision = 'date' | 'datetime' | 'time';

/* The calendar day an instant falls in, formatted the way the activity log heads
   it.
 *
 * Takes `local` for the same reason `Stamp` does, and it matters more here: the
 * server runs UTC and the reader may not, so grouping by local day during SSR
 * would put a different *number of groups* in the server markup than the client
 * builds — a structural hydration mismatch rather than a swapped string. So both
 * sides group by UTC first and regroup locally on the second render. */
export function day(at: Date | string | null | undefined, local: boolean): string | null {
  const iso = isoUtc(at);
  if (!iso) {
    return null;
  }
  if (!local) {
    return iso.slice(0, 10);
  }

  return localDate.format(new Date(iso));
}

// stampText renders an instant at the requested precision, in UTC until the
// component has mounted and in the reader's own timezone after.
function stampText(iso: string, precision: StampPrecision, local: boolean): string {
  if (!local) {
    if (precision === 'time') {
      return iso.slice(11, 16);
    }
    if (precision === 'datetime') {
      return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
    }

    return iso.slice(0, 10);
  }
  const at = new Date(iso);
  if (precision === 'time') {
    return localTime.format(at);
  }
  if (precision === 'datetime') {
    return localDateTime.format(at);
  }

  return localDate.format(at);
}

export function Stamp({
  at,
  precision = 'date',
  className,
}: {
  at: Date | string | null | undefined;
  precision?: StampPrecision;
  /* For the few places where the timestamp is also a layout element — the
     custody log's first grid column, for instance. This renders the only
     `<time>` in those rows; wrapping it in another one would nest `<time>`
     inside `<time>`. */
  className?: string;
}) {
  const iso = isoUtc(at);
  const mounted = useMounted();

  /* A missing timestamp is a real state — a key never presented, a source never
     verified — so it reads as a dash with nothing to hover. */
  if (!iso) return <>—</>;

  const text = stampText(iso, precision, mounted);

  return (
    <Tooltip.Root>
      {/* Not focusable, deliberately. Making every timestamp a tab stop would
          add one per register row — and those rows are `<a>` links, so it would
          also nest a focusable inside a link. The UTC instant stays reachable
          without hovering: it is in `dateTime` on the element itself. If this
          ever needs to be keyboard-reachable, it should be an opt-in prop used
          on the handful of stamps that are not inside links, not a default. */}
      <Tooltip.Trigger asChild>
        {/* `dateTime` carries full precision whether or not anyone hovers, so
            the machine-readable instant is in the DOM for anything reading the
            page rather than looking at it. */}
        <time className={className ? `stamp ${className}` : 'stamp'} dateTime={iso}>
          {text}
        </time>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        {/* Portalled out of the pane. `.index` and `.detail` are both
            `overflow-y: auto`, and the register rows — the densest timestamps
            in the product — would otherwise have their tooltip clipped by the
            scroll container. */}
        <Tooltip.Content className="tip" sideOffset={6} collisionPadding={8}>
          {/* Seconds, not milliseconds: precise enough to identify the instant
              and short enough to read at a glance. */}
          {iso.replace(/\.\d+Z$/, 'Z')}
          <Tooltip.Arrow className="tip__arrow" width={9} height={4} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
