export type ArtworkUploadMime = 'image/png' | 'image/jpeg' | 'image/svg+xml';

const MIME_ALIASES: Readonly<Record<string, ArtworkUploadMime>> = {
  'image/png': 'image/png',
  'image/x-png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/svg+xml': 'image/svg+xml',
};
const EXTENSIONS: Readonly<Record<string, ArtworkUploadMime>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  svg: 'image/svg+xml',
};
/** File-picker filter: extensions cover platforms that report an empty or alias MIME type. */
export const ARTWORK_UPLOAD_ACCEPT = 'image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.jfif,.svg';

/**
 * Upload declaration for a picked file. Browsers often report an empty or alias `File.type`; the server inspects
 * the bytes and stores the detected type, so the declaration is only a hint.
 */
export function artworkUploadMime(file: { readonly name: string; readonly type: string }): ArtworkUploadMime | null {
  const declared = MIME_ALIASES[file.type.trim().toLowerCase()];
  if (declared) return declared;
  const extension = /\.([A-Za-z0-9]+)$/.exec(file.name)?.[1]?.toLowerCase();
  return (extension && EXTENSIONS[extension]) || null;
}
