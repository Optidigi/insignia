import { describe, expect, it } from 'vitest';
import { artworkUploadMime } from './artwork-file.js';

describe('artwork upload declaration', () => {
  it('normalizes browser MIME aliases', () => {
    expect(artworkUploadMime({ name: 'logo', type: 'image/jpg' })).toBe('image/jpeg');
    expect(artworkUploadMime({ name: 'logo', type: 'image/pjpeg' })).toBe('image/jpeg');
    expect(artworkUploadMime({ name: 'logo', type: 'IMAGE/PNG' })).toBe('image/png');
  });
  it('falls back to the extension when the browser reports no usable type', () => {
    expect(artworkUploadMime({ name: 'Photo.JFIF', type: '' })).toBe('image/jpeg');
    expect(artworkUploadMime({ name: 'logo.svg', type: 'application/octet-stream' })).toBe('image/svg+xml');
    expect(artworkUploadMime({ name: 'scan.jpeg', type: '' })).toBe('image/jpeg');
  });
  it('rejects files that are neither a supported type nor a supported extension', () => {
    expect(artworkUploadMime({ name: 'logo.webp', type: 'image/webp' })).toBeNull();
    expect(artworkUploadMime({ name: 'notes', type: '' })).toBeNull();
  });
});
