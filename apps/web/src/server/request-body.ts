// Leave time for Shopify's durable webhook handoff within its five-second delivery window.
const BODY_DEADLINE_MS = 3_000;

/** Own one stream read until completion, disconnection or the total read deadline. */
export async function withRequestBodyReader<T>(
  body: ReadableStream<Uint8Array>,
  requestSignal: AbortSignal,
  consume: (reader: ReadableStreamDefaultReader<Uint8Array>) => Promise<T>,
): Promise<T> {
  const reader = body.getReader();
  const deadline = new AbortController();
  const signal = AbortSignal.any([requestSignal, deadline.signal]);
  const stopReading = () => {
    // Pending reads settle immediately even if the transport takes longer to finish canceling.
    void reader.cancel().catch(() => {});
  };
  const timer = setTimeout(() => deadline.abort(new Error('Request body deadline')), BODY_DEADLINE_MS);
  signal.addEventListener('abort', stopReading, { once: true });
  try {
    signal.throwIfAborted();
    const result = await consume(reader);
    signal.throwIfAborted();
    return result;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stopReading);
    stopReading();
    reader.releaseLock();
  }
}

export async function readRequestJsonObject(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown> | null> {
  if (request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json' || !request.body)
    return null;
  try {
    return await withRequestBodyReader(request.body, request.signal, async (reader) => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes) return null;
        chunks.push(chunk.value);
      }
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    });
  } catch {
    return null;
  }
}
