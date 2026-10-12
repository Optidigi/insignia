import assert from 'node:assert/strict';

export async function readPrivatePacket(stream, timeoutMs = 10000) {
  assert.ok(timeoutMs > 0 && timeoutMs <= 300000);
  const chunks = [];
  let size = 0;
  const timer = setTimeout(() => stream.destroy(new Error('private_packet_timeout')), timeoutMs);
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      assert.ok(size <= 16384, 'private_packet_limit');
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
    for (const chunk of chunks) chunk.fill(0);
  }
}
