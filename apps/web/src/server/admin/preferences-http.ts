import { CommandDigestConflictError } from '@insignia/application';
import { MerchantPreferencesCommandSchema } from '@insignia/contracts';
import { AdminOnlineIdentityError } from '@insignia/shopify';
import type { AdminServices } from './contracts.js';
import { adminBusy, adminJson, busyWithoutEffect, mutationOrigin, validActor } from './http.ts';
import { PreferencesAuthorizationError, PreferencesValidationError } from './preferences.ts';

const maxBody = 256_000;
async function commandBody(request: Request): Promise<unknown> {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json') || !request.body)
    throw new PreferencesValidationError();
  const declared = request.headers.get('Content-Length');
  if (declared && Number(declared) > maxBody) throw new PreferencesValidationError();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > maxBody) {
      await reader.cancel();
      throw new PreferencesValidationError();
    }
    chunks.push(part.value);
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) as unknown;
  } catch {
    throw new PreferencesValidationError();
  }
}

/** Same verified staff authority as other admin APIs; no tenant from a request body. */
export async function handlePreferencesRequest(
  request: Request,
  services: AdminServices | undefined,
): Promise<Response> {
  if (!services?.preferences) return adminJson(503, { error: 'Store preferences unavailable' });
  if (!/^Bearer [^\s]{1,8192}$/.test(request.headers.get('Authorization') ?? ''))
    return adminJson(401, { error: 'Authentication required' });
  try {
    const actor = await services.authenticate(request);
    if (!validActor(actor, Date.now())) return adminJson(401, { error: 'Authentication required' });
    if (!actor.canRead) return adminJson(403, { error: 'Read permission required' });
    if (new URL(request.url).searchParams.size) return adminJson(400, { error: 'Unexpected query parameters' });
    if (request.method === 'GET') return adminJson(200, await services.preferences.read(actor));
    if (request.method !== 'POST') return adminJson(405, { error: 'Method not allowed' });
    if (!actor.canEdit || !mutationOrigin(request, services.appOrigin))
      return adminJson(403, { error: 'Edit permission and same origin required' });
    const key = request.headers.get('Idempotency-Key') ?? '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(key)) return adminJson(400, { error: 'Command key required' });
    const parsed = MerchantPreferencesCommandSchema.safeParse(await commandBody(request));
    if (!parsed.success) return adminJson(422, { error: 'Invalid store preferences' });
    const result = await services.preferences.save(actor, parsed.data, key);
    return adminJson(result.kind === 'saved' ? 200 : 409, result);
  } catch (error) {
    if (busyWithoutEffect(request, error)) return adminBusy();
    if (error instanceof PreferencesAuthorizationError)
      return adminJson(403, { error: 'Current tenant permission required' });
    if (error instanceof PreferencesValidationError) return adminJson(422, { error: 'Invalid store preferences' });
    if (error instanceof CommandDigestConflictError) return adminJson(409, { error: 'Command identity conflict' });
    if (error instanceof AdminOnlineIdentityError && error.stage === 'ONLINE_EXCHANGE_REFRESH_REQUIRED') {
      const result = adminJson(401, { error: 'Authentication required' });
      result.headers.set('X-Shopify-Retry-Invalid-Session-Request', '1');
      return result;
    }
    return adminJson(503, { error: 'Store preferences unavailable' });
  }
}
