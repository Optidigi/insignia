import type { AuthResult, AuthContext } from './auth.ts';
import { createHash } from 'node:crypto';

export interface Draft { label: string; version: number }
export interface DraftAuth {
  expectedOrigin(): string;
  authenticate(request: Request, requireEdit: boolean): Promise<AuthResult>;
}
const INITIAL: Draft = { label: 'Untitled synthetic draft', version: 0 };
const MAX_BODY = 4096;

/** Opaque page-to-POST binding; never a substitute for verified identity. */
export function viewerTag(context: Pick<AuthContext, 'shop' | 'staffId'>): string {
  return createHash('sha256').update(JSON.stringify([context.shop, context.staffId])).digest('hex');
}

export class DraftStore {
  private readonly drafts = new Map<string, Draft>();
  private key(shop: string, staffId: string): string { return JSON.stringify([shop, staffId]); }
  get(shop: string, staffId: string): Draft {
    return { ...(this.drafts.get(this.key(shop, staffId)) ?? INITIAL) };
  }
  save(shop: string, staffId: string, label: string, expectedVersion: number): Draft | null {
    const current = this.get(shop, staffId);
    if (current.version !== expectedVersion) return null;
    const next = { label, version: current.version + 1 };
    this.drafts.set(this.key(shop, staffId), next);
    return { ...next };
  }
}

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'Vary': 'Authorization, Origin',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
function validLabel(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const label = input.trim().normalize('NFC');
  if (!label || Array.from(label).length > 80 || /\p{C}/u.test(label)) return null;
  return label;
}
function parseBody(value: unknown, context: AuthContext): { label: string; version: number } | 'tenant' | 'identity' | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  if ('shop' in object && object.shop !== context.shop) return 'tenant';
  if (object.viewer !== viewerTag(context)) return 'identity';
  if (Object.keys(object).some(key => key !== 'label' && key !== 'version' && key !== 'viewer')) return null;
  const label = validLabel(object.label);
  if (label === null || !Number.isSafeInteger(object.version) || (object.version as number) < 0) return null;
  return { label, version: object.version as number };
}

export async function handleDraftPost(request: Request, auth: DraftAuth, store: DraftStore): Promise<Response> {
  const expected = auth.expectedOrigin();
  const publicUrl = new URL(expected);
  const requestUrl = new URL(request.url);
  // The CLI tunnel terminates HTTPS before forwarding an HTTP request to the
  // local Node adapter. Bind the forwarded request to the exact public host;
  // the browser Origin must still equal the configured HTTPS app origin.
  const forwardedHttps = publicUrl.protocol === 'https:' && requestUrl.protocol === 'http:';
  if (request.headers.get('Origin') !== expected || requestUrl.host !== publicUrl.host ||
      (requestUrl.protocol !== publicUrl.protocol && !forwardedHttps)) {
    return json(403, { error: 'Origin denied' });
  }
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))
    return json(415, { error: 'JSON required' });
  const result = await auth.authenticate(request, true);
  if (!result.ok) return result.response;
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return json(413, { error: 'Body too large' });
    body = JSON.parse(text);
  } catch { return json(422, { error: 'Invalid JSON' }); }
  const parsed = parseBody(body, result.context);
  if (parsed === 'tenant') return json(403, { error: 'Shop mismatch' });
  if (parsed === 'identity') return json(409, { error: 'Identity changed; reload' });
  if (!parsed) return json(422, { error: 'Invalid draft' });
  const saved = store.save(result.context.shop, result.context.staffId, parsed.label, parsed.version);
  return saved ? json(200, saved) : json(409, { error: 'Stale draft version' });
}
