export type Decision = { ok: true } | { ok: false; retryAfter: number };

export type FixedWindowOptions = {
  /** Window length in seconds. */
  window: number;
  /** Requests permitted per key per window. */
  max: number;
  /** Injectable clock, for tests. Milliseconds. */
  now?: () => number;
  /** Entries tolerated before an opportunistic sweep. */
  sweepAt?: number;
};

type Bucket = { count: number; resetAt: number };

/* A fixed window rather than a sliding one or a token bucket.
 *
 * The failure mode of a fixed window is well known: a caller can spend a full
 * allowance at the end of one window and another at the start of the next, so
 * the true worst case over a short span is twice `max`. That is fine for every
 * use here — these limits bound abuse and cost, they are not a billing quota —
 * and it buys an implementation with one integer and one timestamp per key,
 * which is the whole reason to prefer it.
 *
 * State is per-process and in memory. For `/mcp` that is not a compromise but
 * the requirement: the point is to refuse before touching Postgres, so a
 * database-backed counter would do the work the limiter exists to avoid. The
 * consequences are real and worth stating — counters reset when a process
 * restarts, and two replicas of the same service each get their own allowance.
 * A second `app` or `admin` container means moving this to shared storage. */
export class FixedWindow {
  private readonly buckets = new Map<string, Bucket>();
  private readonly window: number;
  private readonly max: number;
  private readonly now: () => number;
  private readonly sweepAt: number;

  constructor(options: FixedWindowOptions) {
    this.window = options.window * 1000;
    this.max = options.max;
    this.now = options.now ?? Date.now;
    this.sweepAt = options.sweepAt ?? 10_000;
  }

  check(key: string): Decision {
    const now = this.now();
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      /* Swept here rather than on a timer. A `setInterval` would have to be
         `unref`'d to avoid holding the process open, and under Vite's HMR the
         admin re-evaluates modules — leaking one live timer per reload. Doing
         it on the way past costs nothing and cannot leak. */
      if (this.buckets.size >= this.sweepAt) this.sweep(now);
      this.buckets.set(key, { count: 1, resetAt: now + this.window });
      return { ok: true };
    }

    if (bucket.count >= this.max) {
      /* Whole seconds, and never zero: `Retry-After: 0` invites an immediate
         retry that is certain to be refused again. */
      return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
    }

    bucket.count += 1;
    return { ok: true };
  }

  /** Forget a key — for clearing an allowance once a caller proves itself. */
  forget(key: string): void {
    this.buckets.delete(key);
  }

  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
