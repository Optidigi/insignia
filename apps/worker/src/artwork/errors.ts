export type ArtworkInspectionFailure = 'REJECTED' | 'UNAVAILABLE' | 'ABORTED';
/** Stable application boundary: bad artwork is terminal; unavailable infrastructure is retryable. */
export class ArtworkInspectionError extends Error {
  readonly code: ArtworkInspectionFailure;
  constructor(code: ArtworkInspectionFailure, message: string) {
    super(message);
    this.code = code;
    this.name = 'ArtworkInspectionError';
  }
}
