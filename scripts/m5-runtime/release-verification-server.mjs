import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { parseReleaseVerificationRequest } from '../../apps/web/src/server/admin/release-verification.ts';

/** Private request receiver for the existing qualified collector. Startup ports
 * hold custody; this protocol supplies no credentials, code or observation data.
 * The collector's existing exclusive intent/append journals fence crash/replay. */
export function createReleaseVerificationServer({ readBinding, readRecord, collect, now = Date.now }) {
  const collecting = new Map();
  async function current(request) {
    assert.ok(now() < request.deadlineMs, 'request_expired');
    assert.deepEqual(await readBinding(), request.binding, 'request_scope_changed');
    assert.ok(now() < request.deadlineMs, 'request_expired');
  }
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Type', 'application/json');
    let input;
    try {
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/verify');
      assert.equal(request.headers['content-type'], 'application/json');
      const chunks = [];
      let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        assert.ok(length <= 4096);
        chunks.push(chunk);
      }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      input = parseReleaseVerificationRequest(JSON.parse(text));
      assert.equal(JSON.stringify(input), text, 'canonical_request_required');
      assert.ok(input.deadlineMs <= now() + 300_000, 'request_deadline_unqualified');
      await current(input);
      const existing = await readRecord?.(input.binding);
      await current(input);
      if (existing) {
        response.end(JSON.stringify({ requestId: input.requestId, recordId: existing, state: 'COMPLETE' }));
        return;
      }
      const key = JSON.stringify(
        Object.keys(input.binding)
          .sort()
          .map((field) => [field, input.binding[field]]),
      );
      let active = collecting.get(key);
      if (!active) {
        active = collect(input);
        collecting.set(key, active);
      }
      let result;
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
