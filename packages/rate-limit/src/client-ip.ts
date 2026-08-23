/** Reads one header by name, case-insensitively. Node's `IncomingHttpHeaders`
 *  and the web `Headers` both satisfy this with a one-line adapter. */
export type HeaderReader = (name: string) => string | undefined;
type ClientIpOptions = {
  fallback: string;
  forwardedHeader: string;
  trustForwarded: boolean;
};

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
 * Compose binds both services to loopback with no proxy, so the defaults leave
 * the header untrusted. An operator with a trusted proxy opts in per service.
 *
 * `X-Forwarded-For` is a chain, so its last entry is taken. A single-value
 * header such as Cloudflare's `CF-Connecting-IP` is used directly instead.
 *
 * `fallback` is what to count when there is no usable address: the socket
 * address where the caller can see one, or a constant. A constant means every
 * such caller shares one bucket, which is a real degradation and only tolerable
 * where the surface is not reachable from a network in the first place. */
export function clientIp(
  header: HeaderReader,
  { fallback, forwardedHeader, trustForwarded }: ClientIpOptions
): string {
  if (!trustForwarded) return fallback;

  const value = header(forwardedHeader);
  if (!value) return fallback;

  if (forwardedHeader.toLowerCase() === 'x-forwarded-for') {
    const last = value.split(',').pop()?.trim();
    if (last) return last;

    return fallback;
  }

  const address = value.trim();
  if (!address) return fallback;

  return address;
}
