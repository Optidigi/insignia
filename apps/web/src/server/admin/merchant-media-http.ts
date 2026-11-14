import { AdminOnlineIdentityError } from '@insignia/shopify';
import type { AdminServices } from './contracts.js';
import { adminBusy, adminJson, busyWithoutEffect, mutationOrigin, validActor } from './http.ts';
import { MerchantMediaError } from './merchant-media.ts';

const limit = 5 * 1024 * 1024;
async function pngBody(request: Request): Promise<Uint8Array | null> {
  if (request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'image/png' || !request.body)
    return null;
  const declared = request.headers.get('Content-Length');
  if (declared && (!/^[0-9]+$/.test(declared) || Number(declared) > limit)) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(part.value);
  }
  return size >= 8 ? Buffer.concat(chunks, size) : null;
}

/** One stored upload's preview image, read by Insignia so the admin browser never connects to private storage. */
export function handleMerchantMediaPreviewRequest(
  request: Request,
  services: AdminServices | undefined,
  productId: string,
  reference: string,
): Promise<Response> {
  return handleMerchantMediaRequest(request, services, productId, reference, true);
}

/** Product identity is route-owned; tenant and generation come only from verified staff auth. */
export async function handleMerchantMediaRequest(
  request: Request,
  services: AdminServices | undefined,
  productId: string,
  reference?: string,
  preview = false,
): Promise<Response> {
  if (!services?.media) return adminJson(503, { error: 'Product media unavailable' });
  if (!/^Bearer [^\s]{1,8192}$/.test(request.headers.get('Authorization') ?? ''))
    return adminJson(401, { error: 'Authentication required' });
  try {
    const actor = await services.authenticate(request);
    if (!validActor(actor, Date.now())) return adminJson(401, { error: 'Authentication required' });
    if (!actor.canRead) return adminJson(403, { error: 'Read permission required' });
    if (!/^gid:\/\/shopify\/Product\/[1-9][0-9]{0,19}$/.test(productId))
      return adminJson(404, { error: 'Product not found' });
    const url = new URL(request.url);
    if (request.method === 'GET') {
      if ([...url.searchParams.keys()].some((key) => key !== 'ids') || (reference && url.searchParams.size))
        return adminJson(422, { error: 'Invalid product media query' });
      if (preview && reference) {
        const bytes = await services.media.readPreview(actor, productId, reference);
        return new Response(Buffer.from(bytes), {
          status: 200,
          headers: {
            // Stored previews are always PNG (the inspector's preview type).
            'Content-Type': 'image/png',
            'Content-Length': String(bytes.byteLength),
            'Cache-Control': 'private, no-store',
            Vary: 'Authorization, Origin',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }
      const values = url.searchParams.getAll('ids');
      if (!reference && (values.length !== 1 || (values[0]?.length ?? 0) > 5000))
        return adminJson(422, { error: 'Media identities required' });
      const ids = reference ? [reference] : (values[0]?.split(',').filter(Boolean) ?? []);
      const result = await services.media.read(actor, productId, ids);
      return adminJson(200, reference ? result.media[0] : result);
    }
    if (request.method !== 'POST' || reference) return adminJson(405, { error: 'Method not allowed' });
    if (!actor.canEdit || !mutationOrigin(request, services.appOrigin))
      return adminJson(403, { error: 'Edit permission and same origin required' });
    if (url.searchParams.size) return adminJson(422, { error: 'Unexpected query parameters' });
    const expectedAuthority = request.headers.get('X-Insignia-Setup-Authority') ?? '';
    if (!/^[a-f0-9]{64}$/.test(expectedAuthority)) return adminJson(422, { error: 'Product authority required' });
    const assetId = request.headers.get('Idempotency-Key') ?? '';
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(assetId))
      return adminJson(422, { error: 'Upload identity required' });
    const bytes = await pngBody(request);
    if (!bytes) return adminJson(422, { error: 'A PNG image of at most 5 MiB is required' });
    return adminJson(200, await services.media.upload(actor, productId, assetId, bytes, expectedAuthority));
  } catch (error) {
    if (busyWithoutEffect(request, error)) return adminBusy();
    if (error instanceof AdminOnlineIdentityError) return adminJson(503, { error: 'Authentication unavailable' });
    if (error instanceof MerchantMediaError)
      return adminJson(
        error.code === 'INVALID_INPUT'
          ? 422
          : error.code === 'NOT_FOUND'
            ? 404
            : error.code === 'CONFLICT' || error.code === 'AUTHORITY_CHANGED'
              ? 409
              : 503,
        {
          error:
            error.code === 'CONFLICT' && request.method === 'POST'
              ? 'Upload identity already belongs to different image bytes. Review the original request.'
              : 'Product media unavailable',
        },
      );
    return adminJson(503, { error: 'Product media unavailable' });
  }
}
