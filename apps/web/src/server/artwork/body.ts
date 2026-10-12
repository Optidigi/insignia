/** One bounded read shared by capability verification and declaration handling. No tee/clone. */
const bodies = new WeakMap<Request, Promise<Record<string, unknown> | null>>();
export function artworkJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const existing = bodies.get(request);
  if (existing) return existing;
  const reading = read(request);
  bodies.set(request, reading);
  return reading;
}
async function read(request: Request): Promise<Record<string, unknown> | null> {
  if (request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json' || !request.body)
    return null;
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Artwork body deadline')), 3000);
  });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2048) return null;
      chunks.push(chunk.value);
    }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    // Cancellation of a hostile transport must not delay the denial response.
    void reader.cancel().catch(() => {});
  }
}

export async function artworkEmptyBody(request: Request): Promise<boolean> {
  if (!request.body) return true;
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const first = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Artwork body deadline')), 3000);
      }),
    ]);
    return first.done === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}
