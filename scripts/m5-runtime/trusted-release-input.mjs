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

/** The pipe retains this Buffer until its end callback; erase only after settlement. */
export async function writePrivatePacket(stream, packet, timeoutMs = 10000) {
  try {
    assert.ok(Buffer.isBuffer(packet) && packet.length <= 16384);
    assert.ok(timeoutMs > 0 && timeoutMs <= 10000);
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
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
