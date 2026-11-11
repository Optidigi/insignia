import { createHmac } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';

/**
 * Owner decision, 11 November 2026: the per-visitor session limit reads only Cloudflare's
 * `X-Insignia-Client-Chain`. A zone transform rule on app.insigniacustomizer.com removes any
 * client-supplied copy and sets it to the X-Forwarded-For that Shopify's app proxy sent, before
 * Cloudflare appends its own hop.
 *
 * Verified natively on 11 November 2026: the chain carried exactly one entry, the buyer's real
 * egress address. A buyer-supplied X-Forwarded-For or X-Insignia-Client-Chain did not change it.
 * The limit uses the last entry, so anything prepended upstream cannot move it. A missing or
 * malformed header means no trusted address, and the limit fails open; the shop ceilings still apply.
 */
export const CLIENT_CHAIN_HEADER = 'x-insignia-client-chain';

/** The address the limit uses, normalized: IPv4 dotted quad, or the /64 prefix of an IPv6 address. */
export function visitorAddress(request: Request): string | null {
  const header = request.headers.get(CLIENT_CHAIN_HEADER);
  if (!header || header.length > 2048) return null;
  const last = header.split(',').at(-1)?.trim() ?? '';
  return normalize(last);
}

function normalize(value: string): string | null {
  if (isIPv4(value)) return value;
  if (!isIPv6(value)) return null;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value)?.[1];
  if (mapped && isIPv4(mapped)) return mapped;
  const [head = '', tail = ''] = value.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  if (right.some((part) => part.includes('.')) || left.some((part) => part.includes('.'))) return null;
  const groups = value.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  if (groups.length !== 8) return null;
  return `${groups
    .slice(0, 4)
    .map((part) => Number.parseInt(part, 16).toString(16))
    .join(':')}::/64`;
}

/** Only a keyed hash of the normalized address leaves this function; the address is never stored or logged. */
export function createVisitorKey(appSecret: string) {
  if (!appSecret) throw new Error('Visitor key secret unavailable');
  const key = createHmac('sha256', appSecret).update('insignia-visitor-address-v1').digest();
  return (request: Request): Uint8Array | null => {
    const address = visitorAddress(request);
    return address ? createHmac('sha256', key).update(address).digest() : null;
  };
}
