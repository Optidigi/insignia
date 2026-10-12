import { createHash } from 'node:crypto';
import { ArtworkInspectionError } from './errors.js';

export { ArtworkInspectionError } from './errors.js';

import { runArtworkSandbox } from './sandbox.js';
export interface ArtworkInspection {
  version: 'm6-inspection-v1';
  mimeType: 'image/png' | 'image/jpeg' | 'image/svg+xml';
  width: number;
  height: number;
  originalSha256: string;
  preview: Uint8Array;
  previewMimeType: 'image/png';
}
export async function inspectArtwork(
  bytes: Uint8Array,
  options: { signal?: AbortSignal } = {},
): Promise<ArtworkInspection> {
  if (bytes.byteLength === 0 || bytes.byteLength > 5 * 1024 * 1024)
    throw new ArtworkInspectionError('REJECTED', 'Artwork size limit');
  try {
    // Capture once: caller mutation cannot alter either the bytes inspected or the returned identity.
    const original = Buffer.from(bytes);
    const result = JSON.parse((await runArtworkSandbox('child.js', original, options.signal)).toString()) as Omit<
      ArtworkInspection,
      'preview'
    > & { preview: string };
    if (
      result.version !== 'm6-inspection-v1' ||
      result.originalSha256 !== createHash('sha256').update(original).digest('hex') ||
      result.previewMimeType !== 'image/png' ||
      !['image/png', 'image/jpeg', 'image/svg+xml'].includes(result.mimeType) ||
      !Number.isSafeInteger(result.width) ||
      !Number.isSafeInteger(result.height) ||
      result.width <= 0 ||
      result.height <= 0 ||
      result.width > 12000 ||
      result.height > 12000 ||
      result.width * result.height > 40_000_000 ||
      typeof result.preview !== 'string'
    )
      throw new ArtworkInspectionError('UNAVAILABLE', 'Invalid inspection result');
    const preview = Buffer.from(result.preview, 'base64');
    if (
      preview.toString('base64') !== result.preview ||
      !preview.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ) {
      throw new ArtworkInspectionError('UNAVAILABLE', 'Invalid inspection preview');
    }
    return { ...result, preview };
  } catch (error) {
    if (error instanceof ArtworkInspectionError) throw error;
    throw new ArtworkInspectionError('UNAVAILABLE', 'Artwork inspector unavailable');
  }
}
