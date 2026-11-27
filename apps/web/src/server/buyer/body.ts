import { readRequestJsonObject } from '../request-body.ts';

/** Bounded single stream read. Capability verification receives a new small body, never a tee. */
export function buyerJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  return readRequestJsonObject(request, 128_000);
}
