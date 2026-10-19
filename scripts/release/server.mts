import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { ReleaseVerificationRequest } from '../../apps/web/src/server/admin/release-verification.ts';
import { parseReleaseVerificationRequest } from '../../apps/web/src/server/admin/release-verification.ts';
import { releaseProfile } from './profiles.mts';

/** Private request receiver for the existing qualified collector. Startup ports
 * hold custody; this protocol supplies no credentials, code or observation data.
 * The collector's existing exclusive intent/append journals fence crash/replay. */
export interface CollectorCompletion {
  classification: string;
  appendAttempted: boolean;
  appendAcknowledged: boolean;
  ambiguousWrite: boolean;
  retryAuthorized: boolean;
  recordId?: string | null;
}
export function createReleaseVerificationServer({
  readBinding,
  readRecord,
  collect,
  now = Date.now,
  profileName,
}: {
  readBinding(): Promise<unknown>;
  readRecord?(binding: ReleaseVerificationRequest['binding']): Promise<string | null>;
  collect(request: ReleaseVerificationRequest): Promise<CollectorCompletion>;
  now?: () => number;
  profileName?: string;
}) {
  const expectedVersion = releaseProfile(profileName).versionId;
  const collecting = new Map<string, Promise<CollectorCompletion>>();
  async function current(request: ReleaseVerificationRequest) {
    assert.ok(now() < request.deadlineMs, 'request_expired');
    assert.deepEqual(await readBinding(), request.binding, 'request_scope_changed');
    assert.ok(now() < request.deadlineMs, 'request_expired');
  }
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Type', 'application/json');
    let input: ReleaseVerificationRequest | undefined;
    try {
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/verify');
      assert.equal(request.headers['content-type'], 'application/json');
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of request) {
        assert.ok(Buffer.isBuffer(chunk));
        length += chunk.length;
        assert.ok(length <= 4096);
        chunks.push(chunk);
      }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      input = parseReleaseVerificationRequest(JSON.parse(text), expectedVersion);
      assert.equal(JSON.stringify(input), text, 'canonical_request_required');
      assert.ok(input.deadlineMs <= now() + 300_000, 'request_deadline_unqualified');
      await current(input);
      const existing = await readRecord?.(input.binding);
      await current(input);
      if (existing) {
        response.end(JSON.stringify({ requestId: input.requestId, recordId: existing, state: 'COMPLETE' }));
        return;
      }
      const key = JSON.stringify(Object.entries(input.binding).sort(([a], [b]) => a.localeCompare(b)));
      let active = collecting.get(key);
      if (!active) {
        active = collect(input);
        collecting.set(key, active);
      }
      let result: CollectorCompletion;
      try {
        result = await active;
      } finally {
        if (collecting.get(key) === active) collecting.delete(key);
      }
      await current(input);
      const complete =
        result.classification === 'TRUSTED_RELEASE_COLLECT_APPEND_ACK' &&
        result.appendAttempted === true &&
        result.appendAcknowledged === true &&
        result.ambiguousWrite === false;
      assert.ok(result.retryAuthorized === false);
      const state = complete ? 'COMPLETE' : result.ambiguousWrite === true ? 'UNCERTAIN' : 'STOPPED';
      response.end(JSON.stringify({ requestId: input.requestId, recordId: complete ? result.recordId : null, state }));
    } catch {
      // No provider/SQL/secret bodies escape. Unqualified admission dispatches nothing.
      response.statusCode = 503;
      response.end(JSON.stringify({ requestId: input?.requestId ?? null, recordId: null, state: 'UNCERTAIN' }));
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  return server;
}
