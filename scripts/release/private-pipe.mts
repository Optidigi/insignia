import assert from 'node:assert/strict';
import type { Readable, Writable } from 'node:stream';

export async function readPrivatePacket(stream: Readable, timeoutMs = 10000) {
  assert.ok(timeoutMs > 0 && timeoutMs <= 300000);
  const chunks: Buffer[] = [];
  let size = 0;
  const timer = setTimeout(() => stream.destroy(new Error('private_packet_timeout')), timeoutMs);
  try {
    for await (const value of stream) {
      const chunk: unknown = value;
      assert(typeof chunk === 'string' || chunk instanceof Uint8Array, 'private_packet_chunk');
      size += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength;
      assert.ok(size <= 16384, 'private_packet_limit');
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
    for (const chunk of chunks) chunk.fill(0);
  }
}

/** The pipe retains this Buffer until its end callback; erase only after settlement. */
export async function writePrivatePacket(stream: Writable, packet: Buffer, timeoutMs = 10000) {
  try {
    assert.ok(Buffer.isBuffer(packet) && packet.length <= 16384);
    assert.ok(timeoutMs > 0 && timeoutMs <= 10000);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          stream.destroy();
          reject(new Error('private_packet_write_failed'));
        } else resolve();
      };
      const onError = () => finish(new Error('private_packet_write_failed'));
      const onClose = () => {
        finish(new Error('private_packet_write_closed'));
        stream.removeListener('error', onError);
      };
      const timer = setTimeout(() => finish(new Error('private_packet_write_timeout')), timeoutMs);
      stream.on('error', onError);
      stream.once('close', onClose);
      try {
        stream.end(packet, finish);
      } catch {
        onError();
      }
    });
  } finally {
    packet.fill(0);
  }
}
