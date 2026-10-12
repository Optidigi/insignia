import type { ArtworkHttpServices } from './http.js';
import { createProductionArtworkServices } from './production.js';

let configured: ArtworkHttpServices | undefined;
/** Explicit production composition only; no mock, guest or inspection fallback. */
export function configureArtworkServices(value: ArtworkHttpServices): void {
  if (configured) throw new Error('Artwork services already configured');
  configured = value;
}
let pending: Promise<ArtworkHttpServices | undefined> | undefined;
export async function artworkServices(): Promise<ArtworkHttpServices | undefined> {
  if (configured) return configured;
  if (!pending)
    pending = createProductionArtworkServices()
      .then((value) => {
        configured = value;
        return value;
      })
      .catch(() => {
        pending = undefined;
        return undefined;
      });
  return pending;
}
