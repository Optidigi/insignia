export type ArtworkInspectionFailure = 'REJECTED' | 'UNAVAILABLE' | 'ABORTED';
/** Stable application boundary: bad artwork is terminal; unavailable infrastructure is retryable. */
export class ArtworkInspectionError extends Error {
  constructor(
    readonly code: ArtworkInspectionFailure,
    message: string,
  ) {
    super(message);
    this.name = 'ArtworkInspectionError';
  }
}
