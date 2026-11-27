import { readRequestJsonObject, withRequestBodyReader } from '../request-body.ts';

/** One bounded read shared by capability verification and declaration handling. No tee/clone. */
const bodies = new WeakMap<Request, Promise<Record<string, unknown> | null>>();
export function artworkJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const existing = bodies.get(request);
  if (existing) return existing;
  const reading = readRequestJsonObject(request, 2_048);
  bodies.set(request, reading);
  return reading;
}
export async function artworkEmptyBody(request: Request): Promise<boolean> {
  if (!request.body) return true;
  try {
    return await withRequestBodyReader(
      request.body,
      request.signal,
      async (reader) => (await reader.read()).done === true,
    );
  } catch {
    return false;
  }
}
