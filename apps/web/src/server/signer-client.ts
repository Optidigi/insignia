import { request as httpRequest } from 'node:http';
import {
  type KeyScope,
  parseSignerProvisionResponse,
  parseSignerSignResponse,
  SIGNER_MAX_BODY_BYTES,
  SIGNER_SOCKET,
  type SignerErrorCode,
  type SignerProvisionRequest,
  type SignerProvisionResponse,
  type SignerSignRequest,
  type SignerSignResponse,
  SignerUnavailableError,
  signerMessageHeader,
} from '@insignia/application';
import type { AuthorizationSigner, SignWholeQuoteInput, SignWholeQuoteResult } from '@insignia/cart-authorization';

export type SignerClient = {
  sign(request: SignerSignRequest): Promise<SignerSignResponse>;
  provision(request: SignerProvisionRequest): Promise<SignerProvisionResponse>;
  /** v3 issuance through the signer; `beforeSign` lets the caller re-check its key selection. */
  authorizationSigner(scope: KeyScope, beforeSign?: (input: SignWholeQuoteInput) => Promise<void>): AuthorizationSigner;
};

const ERROR_CODES: readonly SignerErrorCode[] = ['INVALID_REQUEST', 'KEY_UNAVAILABLE', 'RATE_LIMITED', 'UNAVAILABLE'];

/** Web side of the signer socket. Web never holds a wrapping key or reads a private envelope. */
export function createSignerClient(
  options: { socketPath?: string; signTimeoutMs?: number; provisionTimeoutMs?: number } = {},
): SignerClient {
  const socketPath = options.socketPath ?? SIGNER_SOCKET;
  function post(path: '/v1/sign' | '/v1/provision', body: unknown, timeoutMs: number): Promise<unknown> {
    const payload = Buffer.from(JSON.stringify(body));
    if (payload.length > SIGNER_MAX_BODY_BYTES) return Promise.reject(new SignerUnavailableError('INVALID_REQUEST'));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error: Error | null, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };
      const request = httpRequest(
        {
          socketPath,
          method: 'POST',
          path,
          headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
        },
        (response) => {
          const chunks: Buffer[] = [];
          let length = 0;
          response.on('data', (chunk: Buffer) => {
            length += chunk.length;
            if (length > SIGNER_MAX_BODY_BYTES) {
              response.destroy();
              finish(new SignerUnavailableError('TRANSPORT'));
            } else chunks.push(chunk);
          });
          response.on('error', () => finish(new SignerUnavailableError('TRANSPORT')));
          response.on('end', () => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } catch {
              finish(new SignerUnavailableError('TRANSPORT'));
              return;
            }
            if (response.statusCode === 200) finish(null, parsed);
            else {
              const code = (parsed as { error?: unknown } | null)?.error;
              finish(
                new SignerUnavailableError(
                  ERROR_CODES.includes(code as SignerErrorCode) ? (code as SignerErrorCode) : 'UNAVAILABLE',
                ),
              );
            }
          });
        },
      );
      const timer = setTimeout(() => {
        request.destroy();
        finish(new SignerUnavailableError('TRANSPORT'));
      }, timeoutMs);
      request.on('error', () => finish(new SignerUnavailableError('TRANSPORT')));
      request.end(payload);
    });
  }
  const client: SignerClient = {
    async sign(request) {
      signerMessageHeader(request);
      const value = await post('/v1/sign', request, options.signTimeoutMs ?? 3000);
      try {
        return parseSignerSignResponse(value, request);
      } catch {
        throw new SignerUnavailableError('TRANSPORT');
      }
    },
    async provision(request) {
      const value = await post('/v1/provision', request, options.provisionTimeoutMs ?? 10_000);
      try {
        return parseSignerProvisionResponse(value, request);
      } catch {
        throw new SignerUnavailableError('TRANSPORT');
      }
    },
    authorizationSigner(scope, beforeSign) {
      return {
        async signWholeQuote(input: SignWholeQuoteInput): Promise<SignWholeQuoteResult> {
          await beforeSign?.(input);
          const result = await client.sign({
            version: 1,
            scope,
            keyId: input.keyId,
            issuanceDay: input.issuanceDay,
            message: Buffer.from(input.message).toString('base64url'),
          });
          return {
            keyId: result.keyId,
            publicKeyFingerprint: result.publicKeyFingerprint,
            firstValidDay: result.firstValidDay,
            lastValidDay: result.lastValidDay,
            signature: Buffer.from(result.signature, 'base64url'),
          };
        },
      };
    },
  };
  return client;
}
