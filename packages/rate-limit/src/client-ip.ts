/** Reads one header by name, case-insensitively. Node's `IncomingHttpHeaders`
 *  and the web `Headers` both satisfy this with a one-line adapter. */
export type HeaderReader = (name: string) => string | undefined;

/* Which address a limiter counts against.
 *
 * `trustForwarded` is a deployment fact rather than a preference, and there is
 * no default that is safe in both directions:
 *
 *   - Behind a proxy and *not* reading the forwarded header, every request
 *     appears to come from the proxy. One bucket for the whole internet, and
 *     the first busy client locks everyone else out.
 *   - Not behind a proxy and reading it anyway, any client can set
 *     `X-Forwarded-For` itself and mint a fresh bucket per request. The limiter
 *     is then decorative, which is worse than not having one because it looks
 *     like protection.
 *
 * The second is the dangerous direction, so trusting the header is opt-in. In
 * the shipped compose `app` is always behind Caddy and `admin` is bound to
 * loopback with no proxy at all, which is where the defaults come from.
 *
 * The *last* entry of the chain is taken, not the first. A forwarded list is
 * appended to as it is relayed, so the rightmost value was written by the hop
 * nearest us — the one we actually trust — while the leftmost is whatever the
 * original client claimed about itself. This assumes a single trusted proxy,
 * which is what the shipped topology has; more hops would need to count in from
 * the right by however many are ours.
 *
 * `fallback` is what to count when there is no usable address: the socket
 * address where the caller can see one, or a constant. A constant means every
 * such caller shares one bucket, which is a real degradation and only tolerable
 * where the surface is not reachable from a network in the first place. */
export function clientIp(
  header: HeaderReader,
  { trustForwarded, fallback }: { trustForwarded: boolean; fallback: string }
): string {
  if (trustForwarded) {
    const last = header('x-forwarded-for')?.split(',').pop()?.trim();
    if (last) return last;
  }
  return fallback;
}
