/* One sentence for a failed read, one for a failed write, so that every
   register, queue and bench explains itself the same way.

   `readFailure` used to branch on `/forbidden/i` and offer a second sentence
   about administrator access. Nothing in the repository throws "forbidden" —
   the gate says "Administrator access is required." — so the branch never
   fired, and its wording had gone stale besides: it called administrator a
   property of the *instance*, which stopped being true when roles became
   per-workspace. Nobody was reading it either way, because the routes that
   could refuse a reader are gated by `requireRole('admin')` before their
   loaders run, and every other loader needs only `read`. */
export function readFailure(subject: string): string {
  return `${subject} could not be read. Check that the admin service can reach the database, then retry.`;
}

/* The write-side twin. A refusal from a server function carries a message
   worth showing — "That name is too long." — and most call sites want to add
   what it means for the work in hand: "The name was not changed."

   Joining those two is why this exists. Half the errors thrown in `lib/` end
   in a full stop and half do not, so the fourteen hand-written copies of this
   split into two conventions — `${message}. ${suffix}` and `${message}
   ${suffix}` — each correct only for the errors its own call site can raise.
   That held, but only by everyone checking; adding one error with the other
   shape to an existing function would have produced a double stop or a run-on
   sentence with nothing to catch it. Punctuating here means the call site no
   longer has to know. */
export function writeFailure(cause: unknown, fallback: string, suffix?: string): string {
  const message = cause instanceof Error ? cause.message.trim() : '';
  if (!message) return fallback;
  if (!suffix) return message;
  return `${/[.!?]$/.test(message) ? message : `${message}.`} ${suffix}`;
}
