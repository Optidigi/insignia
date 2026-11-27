import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { artworkEmptyBody, artworkJsonBody } from '../../src/server/artwork/body.ts';

test('artwork declaration and transfer admission release interrupted body reads', async () => {
  for (const [read, rejected] of [
    [artworkJsonBody, null],
    [artworkEmptyBody, false],
  ] as const) {
    const abort = new AbortController();
    let canceled = false;
    const request = new Request('http://local/artwork', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new ReadableStream({
        cancel() {
          canceled = true;
        },
      }),
      signal: abort.signal,
      // @ts-expect-error Node streaming RequestInit requires duplex; browser DOM declarations omit it.
      duplex: 'half',
    });
    const outcome = read(request);
    abort.abort();
    assert.equal(await Promise.race([outcome, delay(150, 'read still pending', { ref: false })]), rejected);
    assert.equal(canceled, true);
    assert.equal(request.body?.locked, false);
  }
});
