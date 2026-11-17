import { createHash, timingSafeEqual } from 'node:crypto';
import type { Observability } from '@insignia/observability';
import { recordSystemFailure, type SystemFailureRecorder } from './observability.ts';

/** Operator metrics scrape. Absent or wrong bearer outcomes are handled; only an unexpected failure
 * while reading the backlog or rendering the registry is recorded, and recording never changes the 503. */
export async function handleInternalMetrics(
  request: Request,
  dependencies: {
    token: string | undefined;
    unresolvedBacklog(): Promise<number>;
    observability: Pick<Observability, 'metrics' | 'registry'>;
    recordSystemFailure?: SystemFailureRecorder;
  },
): Promise<Response> {
  const expected = dependencies.token;
  if (!expected) return new Response(null, { status: 404 });
  const supplied = request.headers.get('authorization');
  if (!supplied?.startsWith('Bearer ') || supplied.length > 512) return new Response(null, { status: 403 });
  const providedHash = createHash('sha256').update(supplied.slice(7)).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  if (!timingSafeEqual(providedHash, expectedHash)) return new Response(null, { status: 403 });
  const { metrics, registry } = dependencies.observability;
  try {
    metrics.unresolvedBacklog(await dependencies.unresolvedBacklog());
    return new Response(await registry.metrics(), {
      status: 200,
      headers: { 'content-type': registry.contentType, 'cache-control': 'no-store' },
    });
  } catch (error) {
    recordSystemFailure(dependencies.recordSystemFailure, 'internal-metrics', error);
    return new Response(null, { status: 503 });
  }
}
