import type { BuyerFailureDiagnostic } from '@insignia/observability';
import { adminJson } from '../admin/http.ts';
import { type ArtworkHttpServices, recordBuyerUnexpected } from './http.ts';

/** Guest (App Proxy) artwork session issue. Absent composition or guest support is a handled 503;
 * only an unexpected exception is recorded, and recording never changes the response. */
export async function handleGuestArtworkSession(
  request: Request,
  dependencies: {
    services(): Promise<Pick<ArtworkHttpServices, 'issueGuest'> | undefined>;
    recordBuyerFailure?(failure: BuyerFailureDiagnostic): void;
  },
): Promise<Response> {
  try {
    const services = await dependencies.services();
    if (!services?.issueGuest) return adminJson(503, { error: 'Artwork session unavailable' });
    const result = await services.issueGuest(request);
    return result ? adminJson(200, result) : adminJson(401, { error: 'Artwork session denied' });
  } catch (error) {
    recordBuyerUnexpected(dependencies.recordBuyerFailure, 'artwork-session', error);
    return adminJson(503, { error: 'Artwork session unavailable' });
  }
}
