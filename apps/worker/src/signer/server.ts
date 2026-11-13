import { createPrivateKey, sign } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  type KeyScope,
  openSigningSeed,
  parseSignerProvisionRequest,
  parseSignerSignRequest,
  publicKeyFingerprint,
  publicKeyFromSeed,
  SIGNER_MAX_BODY_BYTES,
  type SignerErrorCode,
  type SigningKeyHold,
  SigningKeyLifecycle,
  type SigningKeyRing,
  type SigningKeyStore,
  signerMessageHeader,
} from '@insignia/application';

export type SignerAuditEntry = {
  event: 'sign' | 'provision';
  outcome: 'ok' | 'rejected' | 'key_unavailable' | 'rate_limited' | 'unavailable';
  shopId?: string;
  installationGeneration?: string;
  keyId?: number;
  ms: number;
};
export type SignerLimits = {
  /** Sustained signatures per shop per minute, and the burst above it. */
  signPerMinute: number;
  signBurst: number;
  /** New pending keys per shop per hour. */
  provisionPerHour: number;
  /** Concurrent requests across all shops. */
  maxInFlight: number;
};
const DEFAULT_LIMITS: SignerLimits = { signPerMinute: 120, signBurst: 60, provisionPerHour: 6, maxInFlight: 16 };
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

class SignerRefusal extends Error {
  constructor(
    readonly status: number,
    readonly code: SignerErrorCode,
  ) {
    super(code);
  }
}

/** Token buckets keyed by a validated shop; least-recently-used entries are evicted, never all at once. */
function bucketLimiter(capacity: number, refillPerMs: number, clock: () => number, maxKeys = 10_000) {
  const buckets = new Map<string, { tokens: number; at: number }>();
  return (key: string): boolean => {
    const now = clock();
    const bucket = buckets.get(key) ?? { tokens: capacity, at: now };
    bucket.tokens = Math.min(capacity, bucket.tokens + (now - bucket.at) * refillPerMs);
    bucket.at = now;
    buckets.delete(key);
    buckets.set(key, bucket);
    while (buckets.size > maxKeys) {
      const oldest = buckets.keys().next().value;
      if (oldest === undefined) break;
      buckets.delete(oldest);
    }
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  };
}

/**
 * The only process that holds the signing wrapping keys and reads private envelopes. It signs
 * nothing but a well-formed v3 header for the installation's active key, inside that key's window.
 * Audit entries carry scope, key ID, outcome and duration only; never key material or messages.
 */
export function createSignerServer(input: {
  store: SigningKeyStore & SigningKeyHold;
  ring: SigningKeyRing;
  clock?: () => Date;
  audit?: (entry: SignerAuditEntry) => void;
  limits?: Partial<SignerLimits>;
  /** Test seam: runs after every check, immediately before the signature is made. */
  beforeSign?: () => Promise<void>;
}): Server {
  const limits = { ...DEFAULT_LIMITS, ...input.limits };
  const clock = input.clock ?? (() => new Date());
  const now = () => clock().getTime();
  const lifecycle = new SigningKeyLifecycle(input.store, input.ring);
  const signAllowed = bucketLimiter(limits.signBurst + limits.signPerMinute, limits.signPerMinute / 60_000, now);
  const provisionAllowed = bucketLimiter(limits.provisionPerHour, limits.provisionPerHour / 3_600_000, now);
  let inFlight = 0;

  async function readBody(request: IncomingMessage): Promise<unknown> {
    if (request.headers['content-type'] !== 'application/json') throw new SignerRefusal(400, 'INVALID_REQUEST');
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request) {
      length += (chunk as Buffer).length;
      if (length > SIGNER_MAX_BODY_BYTES) throw new SignerRefusal(400, 'INVALID_REQUEST');
      chunks.push(chunk as Buffer);
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    } catch {
      throw new SignerRefusal(400, 'INVALID_REQUEST');
    }
  }
  function parse<T>(parser: (value: unknown) => T, value: unknown): T {
    try {
      return parser(value);
    } catch {
      throw new SignerRefusal(400, 'INVALID_REQUEST');
    }
  }
  // A stale or inactive scope is a key-selection refusal; anything else is unavailability.
  function scopeRefusal(error: unknown): never {
    if (error instanceof Error && /Inactive signing installation|Stale authorization identity/.test(error.message))
      throw new SignerRefusal(409, 'KEY_UNAVAILABLE');
    throw error;
  }
  async function keysFor(scope: KeyScope) {
    try {
      return await input.store.list(scope);
    } catch (error) {
      scopeRefusal(error);
    }
  }

  async function handleSign(body: unknown, audit: Partial<SignerAuditEntry>) {
    const request = parse(parseSignerSignRequest, body);
    Object.assign(audit, {
      shopId: request.scope.shopId,
      installationGeneration: request.scope.installationGeneration,
      keyId: request.keyId,
    });
    const { message } = signerMessageHeader(request);
    // The issuance day is the shop-local day; it is never more than one day from the UTC day.
    if (Math.abs(request.issuanceDay - Math.floor(now() / 86_400_000)) > 1)
      throw new SignerRefusal(400, 'INVALID_REQUEST');
    // The key row is held from this check until the signature exists, so a concurrent revoke,
    // retirement or re-wrap commits either before the check (and is seen) or after the signature.
    // Only in-memory work happens while it is held.
    return input.store
      .holdForSigning(request.scope, request.keyId, async (key) => {
        // Charge the shop's bucket only once its scope is confirmed, so invented shops cannot evict real ones.
        if (!signAllowed(request.scope.shopId)) throw new SignerRefusal(429, 'RATE_LIMITED');
        if (
          key?.state !== 'active' ||
          key.firstDay > request.issuanceDay ||
          key.lastDay < request.issuanceDay + 2 ||
          !key.privateEnvelope ||
          typeof key.privateEnvelope !== 'object' ||
          (key.privateEnvelope as { kid?: unknown }).kid !== key.wrappingKeyId
        )
          throw new SignerRefusal(409, 'KEY_UNAVAILABLE');
        const seed = openSigningSeed(input.ring, request.scope, request.keyId, key.privateEnvelope);
        const der = Buffer.concat([PKCS8_ED25519_PREFIX, seed]);
        try {
          if (
            !publicKeyFromSeed(seed).equals(Buffer.from(key.publicKey)) ||
            publicKeyFingerprint(key.publicKey) !== key.publicKeyFingerprint
          )
            throw new SignerRefusal(409, 'KEY_UNAVAILABLE');
          await input.beforeSign?.();
          const signature = sign(null, message, createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }));
          return {
            keyId: key.id,
            publicKeyFingerprint: key.publicKeyFingerprint,
            firstValidDay: key.firstDay,
            lastValidDay: key.lastDay,
            signature: signature.toString('base64url'),
          };
        } finally {
          seed.fill(0);
          der.fill(0);
        }
      })
      .catch((error: unknown) => scopeRefusal(error));
  }

  async function handleProvision(body: unknown, audit: Partial<SignerAuditEntry>) {
    const request = parse(parseSignerProvisionRequest, body);
    Object.assign(audit, {
      shopId: request.scope.shopId,
      installationGeneration: request.scope.installationGeneration,
      keyId: request.keyId,
    });
    await keysFor(request.scope);
    if (!provisionAllowed(request.scope.shopId)) throw new SignerRefusal(429, 'RATE_LIMITED');
    let created: { publicKeyFingerprint: string };
    try {
      created = await lifecycle.createPending({
        scope: request.scope,
        keyId: request.keyId,
        firstDay: request.firstDay,
        lastDay: request.lastDay,
      });
    } catch (error) {
      if (error instanceof TypeError || (error instanceof Error && 'code' in error && error.code === '23505'))
        throw new SignerRefusal(409, 'KEY_UNAVAILABLE');
      if (error instanceof Error && /installation|identity|capacity/i.test(error.message))
        throw new SignerRefusal(409, 'KEY_UNAVAILABLE');
      throw error;
    }
    const key = (await keysFor(request.scope)).find((candidate) => candidate.id === request.keyId);
    if (key?.state !== 'pending' || key.publicKeyFingerprint !== created.publicKeyFingerprint)
      throw new SignerRefusal(503, 'UNAVAILABLE');
    return {
      keyId: key.id,
      publicKeyFingerprint: key.publicKeyFingerprint,
      publicKeyHex: Buffer.from(key.publicKey).toString('hex'),
    };
  }

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const started = now();
    const event = request.url === '/v1/provision' ? 'provision' : 'sign';
    const audit: Partial<SignerAuditEntry> = {};
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'GET' && request.url === '/health') {
      response.end('{"ok":true}');
      return;
    }
    const reply = (status: number, value: unknown, outcome: SignerAuditEntry['outcome']) => {
      response.statusCode = status;
      response.end(JSON.stringify(value));
      try {
        input.audit?.({ event, outcome, ...audit, ms: Math.max(0, now() - started) });
      } catch {}
    };
    if (request.method !== 'POST' || (request.url !== '/v1/sign' && request.url !== '/v1/provision')) {
      request.resume();
      reply(404, { error: 'INVALID_REQUEST' }, 'rejected');
      return;
    }
    if (inFlight >= limits.maxInFlight) {
      request.resume();
      reply(503, { error: 'UNAVAILABLE' }, 'unavailable');
      return;
    }
    inFlight += 1;
    void (async () => {
      try {
        const body = await readBody(request);
        const result = event === 'sign' ? await handleSign(body, audit) : await handleProvision(body, audit);
        reply(200, result, 'ok');
      } catch (error) {
        if (error instanceof SignerRefusal)
          reply(
            error.status,
            { error: error.code },
            error.code === 'RATE_LIMITED'
              ? 'rate_limited'
              : error.code === 'KEY_UNAVAILABLE'
                ? 'key_unavailable'
                : error.code === 'UNAVAILABLE'
                  ? 'unavailable'
                  : 'rejected',
          );
        else reply(503, { error: 'UNAVAILABLE' }, 'unavailable');
      } finally {
        inFlight -= 1;
      }
    })();
  });
  // A stalled client cannot hold an in-flight slot for long.
  server.headersTimeout = 5_000;
  server.requestTimeout = 10_000;
  return server;
}
