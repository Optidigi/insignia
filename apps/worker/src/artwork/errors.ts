export type ArtworkInspectionFailure = 'REJECTED' | 'UNAVAILABLE' | 'ABORTED';
/** A rejection the buyer can act on, stored with the artwork instead of the generic reason (#445). */
export type ArtworkInspectionReason = 'DIMENSIONS_TOO_LARGE';
/** Stable application boundary: bad artwork is terminal; unavailable infrastructure is retryable. */
export class ArtworkInspectionError extends Error {
  readonly code: ArtworkInspectionFailure;
  readonly reason?: ArtworkInspectionReason;
  constructor(code: ArtworkInspectionFailure, message: string, reason?: ArtworkInspectionReason) {
    super(message);
    this.code = code;
    this.reason = reason;
    this.name = 'ArtworkInspectionError';
  }
}
