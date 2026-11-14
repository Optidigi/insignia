import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import type { ReleaseVerificationCollector } from './release-evidence.js';
import { resolveRuntimeReleaseProfile } from './runtime-release-profile.js';

export type ReleaseVerificationRequest = Parameters<ReleaseVerificationCollector['collect']>[0];
export const RELEASE_VERIFICATION_SOCKET = '/run/insignia/release-verification/collector.sock';
/**
 * Background refresh asks for a new trusted release record once the stored one would lapse within
 * this lead, so a ~5 s collection lands before it expires. The receiver therefore reuses a stored
 * record only while it stays fresh for this long; otherwise it would answer the refresh with the
 * record that is about to lapse and nothing would be collected ahead of expiry (#345).
 */
export const RELEASE_REFRESH_LEAD_MS = 8_000;

/** Closed metadata-only protocol. Staff credentials, provider observations,
 * executable paths and append credentials cannot be selected by this request. */
export function parseReleaseVerificationRequest(
  value: unknown,
  expectedVersion: string = resolveRuntimeReleaseProfile().activeVersionRef,
): ReleaseVerificationRequest {
  const reviewedVersions: readonly string[] = [
    'native-merchant-batch-a03b41ba',
    'native-a11y-quantity-9b5dbdee',
    'native-session-drafts-c78a8179',
    'native-repair-messages-bf512171',
    'native-buyer-fixes-fb436e16',
    'native-canonical-host-aa3b6166',
    'native-cart-line-v3-aa3b6166',
    'native-functions-renew-8fffc9de',
    'native-cart-repair-eb386d22',
    'native-canonical-313b12ad',
    'native-review-nav-8a7ee446',
    'native-loading-defd05b0',
    'native-review-cart-1f4595f',
    'native-startup-771bb8f',
    'native-recovery-e2c3dc5',
    'native-speed-e52be93',
    'native-performance-b2729a6',
    'native-parity-466a687',
    'native-behavior-6b6c15e',
    'native-selected-fixed-81830c6',
    'native-cart-fd9cc61',
    'native-fixed-5c04fa8',
    'native-theme-ced0143',
    'selected-ui-aab4a4b',
    'selected-ui-f48efa2',
    'm5-functions-9c2e56b42fbf',
    'm8-read-orders-617057f',
    'm8-app-proxy-3d2a02e',
    'm8-theme-c8d8713',
    'm8-cookie-91b35ab',
    'm8-preview-28443bd',
    'lean-markets-7b17cd9',
    'lean-privacy-theme-23fd116',
  ].map((name) => resolveRuntimeReleaseProfile(name).activeVersionRef);
  assert.ok(reviewedVersions.includes(expectedVersion), 'reviewed_release_target_required');
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  const input = value as ReleaseVerificationRequest;
  assert.deepEqual(Object.keys(input).sort(), ['binding', 'deadlineMs', 'expectedActiveAppVersionRef', 'requestId']);
  assert.match(input.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(input.expectedActiveAppVersionRef, expectedVersion);
  assert.ok(Number.isSafeInteger(input.deadlineMs));
  assert.ok(input.binding && typeof input.binding === 'object');
  assert.deepEqual(Object.keys(input.binding).sort(), [
    'appClientId',
    'authorizationEpoch',
    'authorizationGeneration',
    'externalInstallationId',
    'installationGeneration',
    'shopId',
  ]);
  assert.equal(input.binding.appClientId, '1443cf6d03d39edae7c101a943c5c684');
  assert.match(input.binding.shopId, /^[A-Za-z0-9_-]{1,128}$/);
  assert.match(input.binding.installationGeneration, /^[1-9][0-9]{0,19}$/);
  assert.match(input.binding.authorizationGeneration, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.ok(Number.isSafeInteger(input.binding.authorizationEpoch) && input.binding.authorizationEpoch >= 0);
  assert.match(input.binding.externalInstallationId, /^gid:\/\/shopify\/AppInstallation\/[1-9][0-9]*$/);
  return structuredClone(input);
}

/** Fixed private Unix socket: no browser endpoint or configurable remote shell.
 * The independently privileged process owns custody and durable dispatch. */
export function createReleaseVerificationClient(
  socketPath = RELEASE_VERIFICATION_SOCKET,
  expectedVersion: string = resolveRuntimeReleaseProfile().activeVersionRef,
): ReleaseVerificationCollector {
  return {
    async collect(value) {
      const input = parseReleaseVerificationRequest(value, expectedVersion);
      const remaining = Math.min(300_000, input.deadlineMs - Date.now());
      if (remaining <= 0) throw new Error('Publication verification expired');
      return new Promise((resolve, reject) => {
        const fail = () => reject(new Error('Publication verification unavailable'));
        const request = httpRequest(
          {
            socketPath,
            method: 'POST',
            path: '/verify',
            headers: { 'Content-Type': 'application/json' },
          },
          (response) => {
            const chunks: Buffer[] = [];
            let length = 0;
            response.on('data', (chunk: Buffer) => {
              length += chunk.length;
              if (length > 4096) {
                response.destroy();
                fail();
              } else chunks.push(chunk);
            });
            response.on('error', fail);
            response.on('end', () => {
              clearTimeout(timer);
              try {
                assert.equal(response.statusCode, 200);
                const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                assert.deepEqual(Object.keys(result).sort(), ['recordId', 'requestId', 'state']);
                assert.equal(result.requestId, input.requestId);
                assert.ok(['COMPLETE', 'WAITING', 'STOPPED', 'UNCERTAIN'].includes(result.state));
                assert.ok(result.recordId === null || /^[0-9a-f-]{36}$/.test(result.recordId));
                assert.ok(result.state !== 'COMPLETE' || result.recordId !== null);
                resolve(result);
              } catch {
                fail();
              }
            });
          },
        );
        const timer = setTimeout(() => {
          request.destroy();
          fail();
        }, remaining);
        request.on('error', () => {
          clearTimeout(timer);
          fail();
        });
        request.end(JSON.stringify(input));
      });
    },
  };
}
