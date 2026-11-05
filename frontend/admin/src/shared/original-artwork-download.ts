/** Original URLs are signed with an attachment Content-Disposition by storage.
 * Navigate directly so downloads do not depend on object-storage CORS or popups. */
export function startOriginalArtworkDownload(url: string): void {
  window.open(url, '_self');
}
