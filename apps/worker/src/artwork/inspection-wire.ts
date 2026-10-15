import { createHash } from 'node:crypto';
import type { ArtworkInspection } from './inspection.js';

export const INSPECTION_INPUT_LIMIT = 5 * 1024 * 1024;
export const INSPECTION_OUTPUT_LIMIT = 3 * 1024 * 1024;
/** Treat even the private peer as untrusted; bind the result to the caller's exact buffer. */
export function decodeInspectionResult(value: unknown, original: Uint8Array): ArtworkInspection {
  const result = value as Record<string, unknown> | null;
  if (
    result?.version !== 'm6-inspection-v1' ||
    !['image/png', 'image/jpeg', 'image/svg+xml'].includes(String(result.mimeType)) ||
    result.originalSha256 !== createHash('sha256').update(original).digest('hex') ||
    result.previewMimeType !== 'image/png' ||
    typeof result.width !== 'number' ||
    typeof result.height !== 'number' ||
    !Number.isSafeInteger(result.width) ||
    !Number.isSafeInteger(result.height) ||
    result.width <= 0 ||
    result.height <= 0 ||
    result.width > 12000 ||
    result.height > 12000 ||
    result.width * result.height > 40_000_000 ||
    typeof result.preview !== 'string' ||
    result.preview.length > Math.ceil((2 * 1024 * 1024) / 3) * 4
  )
    throw new Error('Invalid private inspection result');
  const preview = Buffer.from(result.preview, 'base64');
  if (
    preview.length > 2 * 1024 * 1024 ||
    preview.toString('base64') !== result.preview ||
    !preview.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error('Invalid private inspection result');
  return {
    version: 'm6-inspection-v1',
    mimeType: result.mimeType as ArtworkInspection['mimeType'],
    width: result.width,
    height: result.height,
    originalSha256: result.originalSha256,
    previewMimeType: 'image/png',
    preview,
  };
}
