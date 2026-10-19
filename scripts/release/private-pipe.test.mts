import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { test } from 'node:test';
import { readPrivatePacket, writePrivatePacket } from './private-pipe.mts';

test('private input is bounded by actual bytes, including decoded stream chunks', async () => {
  const valid = new PassThrough();
  const reading = readPrivatePacket(valid);
  valid.end(Buffer.alloc(16384, 7));
  assert.equal((await reading).byteLength, 16384);
  const unicode = new PassThrough();
  unicode.setEncoding('utf8');
  const oversized = readPrivatePacket(unicode);
  unicode.end('é'.repeat(9000));
  await assert.rejects(oversized, /private_packet_limit/);
  await assert.rejects(readPrivatePacket(new PassThrough(), 5), /private_packet_timeout/);
});

test('private output erases its owned packet after success, failure and a bounded stalled write', async () => {
  let delivered = '';
  const target = new Writable({
    write(chunk: Buffer, _encoding, done) {
      delivered += chunk.toString();
      done();
    },
  });
  const packet = Buffer.from('synthetic-private-packet');
  await writePrivatePacket(target, packet);
  assert.equal(delivered, 'synthetic-private-packet');
  assert(packet.every((byte) => byte === 0));
  const failed = Buffer.from('synthetic-failure');
  await assert.rejects(
    writePrivatePacket(
      new Writable({
        write(_chunk, _encoding, done) {
          done(new Error('rejected'));
        },
      }),
      failed,
    ),
    /private_packet_write_failed/,
  );
  assert(failed.every((byte) => byte === 0));
  const stalled = Buffer.from('synthetic-stall');
  await assert.rejects(writePrivatePacket(new Writable({ write() {} }), stalled, 5), /private_packet_write_failed/);
  assert(stalled.every((byte) => byte === 0));
});
