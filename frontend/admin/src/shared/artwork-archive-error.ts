import { createAdminTranslator } from '@insignia/ui-localization/admin';
import type { ExportMessage } from './production-sheet.js';

const english = createAdminTranslator('en');

export type ArtworkArchiveErrorCode =
  | 'accessExpired'
  | 'orderUnverified'
  | 'originalReadFailed'
  | 'originalSizeUnverified'
  | 'selectionRange'
  | 'archiveSizeLimit'
  | 'checksumUnverified'
  | 'prepareBeforeDownload'
  | 'orderChanged'
  | 'prepareFailed'
  | 'downloadUnavailable';

export type ArtworkArchiveEntryReasonCode =
  | 'detailsNotRetained'
  | 'artworkUnavailable'
  | 'fileLimitReached'
  | 'archiveSizeLimit'
  | 'accessExpired'
  | 'originalUnavailable'
  | 'originalLoadFailed'
  | 'originalUnverified'
  | 'originalReadFailed'
  | 'originalSizeUnverified'
  | 'checksumUnverified';

export class ArtworkArchiveError extends Error {
  readonly code: ArtworkArchiveErrorCode;
  readonly displayMessage: ExportMessage;
  readonly retryable: boolean;

  constructor(code: ArtworkArchiveErrorCode, displayMessage: ExportMessage, options: { retryable?: boolean } = {}) {
    super(english.message(displayMessage));
    this.name = 'ArtworkArchiveError';
    this.code = code;
    this.displayMessage = displayMessage;
    this.retryable = options.retryable ?? false;
  }
}
