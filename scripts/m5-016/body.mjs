import { requireValue, Stop } from '../m5-011/operator.mjs';
export async function bytes(response, signal) {
  requireValue(response.body, 'body_missing');
  const reader = response.body.getReader();
  let cancellation;
  const cancel = () =>
    (cancellation ??= reader.cancel().catch(() => {
      throw new Stop('body_disposal_unsettled');
    }));
  const abort = () => {
    void cancel().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const n = await reader.read();
      if (n.done) break;
      size += n.value.byteLength;
      requireValue(size <= 128 * 1024, 'body_bound');
      chunks.push(n.value);
    }
  } catch (error) {
    await cancel();
    throw error;
  } finally {
    if (signal.aborted) await cancel();
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
  requireValue(!signal.aborted, 'transport_timeout');
  return Buffer.concat(chunks, size);
}
