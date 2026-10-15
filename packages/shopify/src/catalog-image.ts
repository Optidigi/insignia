import { lookup as resolve } from 'node:dns/promises';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { isIPv4 } from 'node:net';
import type { CatalogProduct } from './catalog.js';

const limit = 5 * 1024 * 1024;
type ContentType = 'image/png' | 'image/jpeg' | 'image/svg+xml';
export class CatalogImageError extends Error {
  constructor(readonly code: 'INVALID_REFERENCE' | 'UNAVAILABLE' | 'TOO_LARGE' | 'UNSUPPORTED_TYPE') {
    super(code);
    this.name = 'CatalogImageError';
  }
}
function publicAddress(address: string): boolean {
  if (!isIPv4(address)) return false;
  const [a, b, c] = address.split('.').map(Number) as [number, number, number, number];
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && ((b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99) || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
/** Server-only catalog input: callers authenticate the merchant/product first. No browser URL input.
 * This reads bounded uninspected bytes, not an approved asset or an immutable-history receipt.
 * Unsupported CDN hosts/formats remain explicit; never fall back to an arbitrary fetch.
 */
export function createCatalogImageReader(
  input: {
    lookup?: (hostname: string, options: { family: 4; all: true }) => Promise<{ address: string; family: number }[]>;
    request?: (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;
  } = {},
) {
  const lookup = input.lookup ?? ((hostname: string, options: { family: 4; all: true }) => resolve(hostname, options));
  const request = input.request ?? httpsRequest;
  return {
    async read(
      product: CatalogProduct,
      imageRevisionId: string,
      signal?: AbortSignal,
    ): Promise<{
      imageRevisionId: string;
      contentType: ContentType;
      bytes: Uint8Array;
    } | null> {
      const productId = /^gid:\/\/shopify\/Product\/([1-9][0-9]{0,19})$/.exec(product.id)?.[1];
      const variantId = /^variant_([1-9][0-9]{0,19})$/.exec(imageRevisionId)?.[1];
      const variants = variantId
        ? product.variants.filter((v) => v.id === `gid://shopify/ProductVariant/${variantId}`)
        : [];
      if (!productId || (imageRevisionId !== `product_${productId}` && variants.length !== 1))
        throw new CatalogImageError('INVALID_REFERENCE');
      const image = variantId ? (variants[0]?.image ?? product.image) : product.image;
      if (!image) return null;
      let url: URL;
      try {
        url = new URL(image.url);
      } catch {
        throw new CatalogImageError('UNAVAILABLE');
      }
      if (
        image.url.length > 2048 ||
        url.protocol !== 'https:' ||
        url.hostname !== 'cdn.shopify.com' ||
        url.port ||
        url.username ||
        url.password ||
        url.hash
      )
        throw new CatalogImageError('UNAVAILABLE');
      const deadline = AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]);
      if (deadline.aborted) throw new CatalogImageError('UNAVAILABLE');
      return new Promise((resolve, reject) => {
        let done = false,
          req: ClientRequest | undefined,
          response: IncomingMessage | undefined;
        const finish = (
          error: CatalogImageError | null,
          value?: { imageRevisionId: string; contentType: ContentType; bytes: Uint8Array },
        ) => {
          if (done) return;
          done = true;
          deadline.removeEventListener('abort', abort);
          if (error) {
            response?.destroy();
            req?.destroy();
            reject(error);
          } else if (value) resolve(value);
          else reject(new CatalogImageError('UNAVAILABLE'));
        };
        const abort = () => finish(new CatalogImageError('UNAVAILABLE'));
        deadline.addEventListener('abort', abort, { once: true });
        void Promise.resolve()
          .then(() => lookup(url.hostname, { family: 4, all: true }))
          .then((addresses) => {
            if (done) return;
            if (
              !addresses[0]?.address ||
              addresses.length > 16 ||
              addresses.some((v) => v.family !== 4 || !publicAddress(v.address))
            )
              throw new CatalogImageError('UNAVAILABLE');
            const address = addresses[0]?.address;
            if (!address) throw new CatalogImageError('UNAVAILABLE');
            req = request(
              url,
              {
                method: 'GET',
                agent: false,
                family: 4,
                maxHeaderSize: 16 * 1024,
                servername: url.hostname,
                rejectUnauthorized: true,
                headers: { Accept: 'image/png, image/jpeg, image/svg+xml', 'Accept-Encoding': 'identity' },
                lookup: (hostname, options, callback) => {
                  if (hostname !== url.hostname) return callback(new Error('CDN_HOST_DRIFT'), '', 4);
                  if (options.all) callback(null, [{ address, family: 4 }]);
                  else callback(null, address, 4);
                },
              },
              (incoming) => {
                response = incoming;
                if (done) {
                  incoming.destroy();
                  return;
                }
                incoming.on('error', abort);
                incoming.on('aborted', abort);
                const type = incoming.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
                const length = incoming.headers['content-length'];
                if (
                  incoming.statusCode !== 200 ||
                  (incoming.headers['content-encoding'] && incoming.headers['content-encoding'] !== 'identity')
                )
                  return finish(new CatalogImageError('UNAVAILABLE'));
                if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(type ?? ''))
                  return finish(new CatalogImageError('UNSUPPORTED_TYPE'));
                if (length !== undefined && (!/^[0-9]+$/.test(length) || Number(length) < 1 || Number(length) > limit))
                  return finish(new CatalogImageError('TOO_LARGE'));
                const chunks: Buffer[] = [];
                let size = 0;
                incoming.on('data', (chunk: Buffer) => {
                  if (done) return;
                  size += chunk.byteLength;
                  if (size > limit) finish(new CatalogImageError('TOO_LARGE'));
                  else chunks.push(Buffer.from(chunk));
                });
                incoming.on('end', () => {
                  if (done) return;
                  if (!incoming.complete || size === 0 || (length !== undefined && size !== Number(length)))
                    return finish(new CatalogImageError('UNAVAILABLE'));
                  finish(null, {
                    imageRevisionId,
                    contentType: type as ContentType,
                    bytes: new Uint8Array(Buffer.concat(chunks, size)),
                  });
                });
              },
            );
            req.on('error', abort);
            req.end();
          })
          .catch((error) => finish(error instanceof CatalogImageError ? error : new CatalogImageError('UNAVAILABLE')));
      });
    },
  };
}
