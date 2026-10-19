import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import test from 'node:test';
import { writePrivatePacket } from '../release/private-pipe.mts';

test('bootstrap private frame remains intact until delayed pipe flush then is erased', async () => {
  const packet = Buffer.from('{"clientSecret":"SYNTHETIC_PRIVATE","databaseUrl":"SYNTHETIC"}');
  const expected = Buffer.from(packet);
  let received: Buffer | undefined;
  const pipe = new Writable({
    write(chunk, _encoding, callback) {
      setImmediate(() => {
        received = Buffer.from(chunk);
        callback();
      });
    },
  });
  await writePrivatePacket(pipe, packet);
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(received, expected);
  assert.ok(packet.every((byte) => byte === 0));
});

test('bootstrap EPIPE, premature close and stalled pipe stop boundedly and erase private bytes', async () => {
  for (const outcome of ['error', 'close', 'stall']) {
    const packet = Buffer.from('SYNTHETIC_PRIVATE');
    const pipe = new Writable({
      write(_chunk, _encoding, callback) {
        if (outcome === 'error') setImmediate(() => callback(Object.assign(new Error('synthetic'), { code: 'EPIPE' })));
        if (outcome === 'close') setImmediate(() => this.destroy());
      },
    });
    await assert.rejects(writePrivatePacket(pipe, packet, 30));
    assert.ok(packet.every((byte) => byte === 0));
    assert.equal(pipe.destroyed, true);
  }
});
