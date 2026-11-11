import { DOMAIN_V3, decodeHeaderV3, HEADER_V3_BYTES, type HeaderV3 } from '@insignia/cart-authorization';
import type { KeyScope } from './crypto.js';

/**
 * Private signer protocol: JSON over HTTP on a Unix socket that only the web runtime mounts.
 * The signer process alone holds the signing wrapping key and reads private envelopes; web sends
 * the exact v3 bytes to sign and receives a signature, or asks for a new pending key and receives
 * only its public half.
 */
export const SIGNER_SOCKET_DIRECTORY = '/run/insignia/signer';
export const SIGNER_SOCKET = `${SIGNER_SOCKET_DIRECTORY}/signer.sock`;
export const SIGNER_MAX_BODY_BYTES = 4096;

export type SignerSignRequest = {
  version: 1;
  scope: KeyScope;
  keyId: number;
  issuanceDay: number;
  message: string;
};
export type SignerSignResponse = {
  keyId: number;
  publicKeyFingerprint: string;
  firstValidDay: number;
  lastValidDay: number;
  signature: string;
};
export type SignerProvisionRequest = {
  version: 1;
  scope: KeyScope;
  keyId: number;
  firstDay: number;
  lastDay: number;
};
export type SignerProvisionResponse = { keyId: number; publicKeyFingerprint: string; publicKeyHex: string };
export type SignerErrorCode = 'INVALID_REQUEST' | 'KEY_UNAVAILABLE' | 'RATE_LIMITED' | 'UNAVAILABLE';

/** Signer unreachable, overloaded or refusing: the caller fails closed and may retry. */
export class SignerUnavailableError extends Error {
  readonly retryable = true;
  constructor(readonly code: SignerErrorCode | 'TRANSPORT' = 'UNAVAILABLE') {
    super('Authorization signer unavailable');
    this.name = 'SignerUnavailableError';
  }
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Signer object required');
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new TypeError('Signer fields mismatch');
  return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw new TypeError('Signer integer out of range');
  return value;
}
function base64url(value: unknown, maxBytes: number): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value)) throw new TypeError('Signer bytes invalid');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length > maxBytes || bytes.toString('base64url') !== value) throw new TypeError('Signer bytes invalid');
  return bytes;
}
export function parseSignerScope(value: unknown): KeyScope {
  const input = record(value, ['shopId', 'installationGeneration', 'authorizationGeneration', 'authorizationEpoch']);
  if (typeof input.shopId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.shopId))
    throw new TypeError('Signer shop invalid');
  if (typeof input.installationGeneration !== 'string' || !/^[1-9][0-9]{0,18}$/.test(input.installationGeneration))
    throw new TypeError('Signer generation invalid');
  if (
    typeof input.authorizationGeneration !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.authorizationGeneration)
  )
    throw new TypeError('Signer authorization generation invalid');
  return {
    shopId: input.shopId,
    installationGeneration: input.installationGeneration,
    authorizationGeneration: input.authorizationGeneration,
    authorizationEpoch: integer(input.authorizationEpoch, 0, 0xffffffff),
  };
}
export function parseSignerSignRequest(value: unknown): SignerSignRequest {
  const input = record(value, ['version', 'scope', 'keyId', 'issuanceDay', 'message']);
  if (input.version !== 1) throw new TypeError('Signer version unsupported');
  const request: SignerSignRequest = {
    version: 1,
    scope: parseSignerScope(input.scope),
    keyId: integer(input.keyId, 1, 65535),
    issuanceDay: integer(input.issuanceDay, 0, 0x7fffffff - 2),
    message: String(input.message),
  };
  signerMessageHeader(request);
  return request;
}
/**
 * The message must be exactly the v3 domain followed by a well-formed v3 header whose key,
 * generation, epoch and D+2 expiry match the request. Nothing else is ever signed.
 */
export function signerMessageHeader(request: SignerSignRequest): { header: HeaderV3; message: Buffer } {
  const message = base64url(request.message, DOMAIN_V3.length + HEADER_V3_BYTES);
  if (message.length !== DOMAIN_V3.length + HEADER_V3_BYTES || !message.subarray(0, DOMAIN_V3.length).equals(DOMAIN_V3))
    throw new TypeError('Signer message is not a v3 header');
  const header = decodeHeaderV3(message.subarray(DOMAIN_V3.length));
  if (
    header.keyId !== request.keyId ||
    header.generationHex !== request.scope.authorizationGeneration.replaceAll('-', '') ||
    header.epoch !== request.scope.authorizationEpoch ||
    header.validThroughDay !== request.issuanceDay + 2
  )
    throw new TypeError('Signer header does not match its scope');
  return { header, message };
}
export function parseSignerSignResponse(value: unknown, request: SignerSignRequest): SignerSignResponse {
  const input = record(value, ['keyId', 'publicKeyFingerprint', 'firstValidDay', 'lastValidDay', 'signature']);
  const response: SignerSignResponse = {
    keyId: integer(input.keyId, 1, 65535),
    publicKeyFingerprint: String(input.publicKeyFingerprint),
    firstValidDay: integer(input.firstValidDay, 0, 0x7fffffff),
    lastValidDay: integer(input.lastValidDay, 0, 0x7fffffff),
    signature: String(input.signature),
  };
  if (
    response.keyId !== request.keyId ||
    !/^[0-9a-f]{64}$/.test(response.publicKeyFingerprint) ||
    base64url(response.signature, 64).length !== 64
  )
    throw new TypeError('Signer response invalid');
  return response;
}
export function parseSignerProvisionRequest(value: unknown): SignerProvisionRequest {
  const input = record(value, ['version', 'scope', 'keyId', 'firstDay', 'lastDay']);
  if (input.version !== 1) throw new TypeError('Signer version unsupported');
  const request: SignerProvisionRequest = {
    version: 1,
    scope: parseSignerScope(input.scope),
    keyId: integer(input.keyId, 1, 65535),
    firstDay: integer(input.firstDay, 0, 0x7fffffff),
    lastDay: integer(input.lastDay, 0, 0x7fffffff),
  };
  if (request.firstDay > request.lastDay) throw new TypeError('Signer key window invalid');
  return request;
}
export function parseSignerProvisionResponse(value: unknown, request: SignerProvisionRequest): SignerProvisionResponse {
  const input = record(value, ['keyId', 'publicKeyFingerprint', 'publicKeyHex']);
  if (
    input.keyId !== request.keyId ||
    typeof input.publicKeyFingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/.test(input.publicKeyFingerprint) ||
    typeof input.publicKeyHex !== 'string' ||
    !/^[0-9a-f]{64}$/.test(input.publicKeyHex)
  )
    throw new TypeError('Signer provision response invalid');
  return { keyId: request.keyId, publicKeyFingerprint: input.publicKeyFingerprint, publicKeyHex: input.publicKeyHex };
}
