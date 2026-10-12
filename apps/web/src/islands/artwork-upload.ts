export type ArtworkPreview = {
  assetId: string;
  url: string;
  aspectRatio: number;
  expiresAt: string;
  assetExpiresAt: string;
};
export type JsonApi = <T>(path: string, init?: RequestInit) => Promise<T>;
type Status = { state: string; expiresAt: string };
export function createArtworkUpload(input: {
  api: JsonApi;
  put?: typeof fetch;
  pause?: (ms: number, signal?: AbortSignal) => Promise<void>;
}) {
  const put = input.put ?? fetch;
  const pause =
    input.pause ??
    ((ms, signal) =>
      new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', abort);
          resolve();
        }, ms);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      }));
  return {
    async upload(file: File, onState: (state: string) => void, signal?: AbortSignal): Promise<ArtworkPreview> {
      if (
        !['image/svg+xml', 'image/png', 'image/jpeg'].includes(file.type) ||
        file.size < 1 ||
        file.size > 5 * 1024 * 1024
      )
        throw new Error('Choose an SVG, PNG or JPEG up to 5 MiB.');
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      onState('Allocating private upload');
      const admitted = await input.api<{
        assetId: string;
        upload: { url: string; headers: Record<string, string> };
        expiresAt: string;
      }>('/api/artwork', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: file.type, byteLength: file.size }),
        signal,
      });
      onState('Uploading');
      const deadline = AbortSignal.timeout(30_000);
      const uploadSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
      // The storage request carries only its signed headers, never the Admin bearer or cookies.
      const response = await put(admitted.upload.url, {
        method: 'PUT',
        headers: admitted.upload.headers,
        body: file,
        credentials: 'omit',
        redirect: 'error',
        signal: uploadSignal,
      });
      if (!response.ok) throw new Error('Private upload failed. Choose the file again to start a new upload.');
      await input.api(`/api/artwork/${admitted.assetId}/complete`, { method: 'POST', signal });
      for (let attempt = 0; attempt < 120; attempt++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const status = await input.api<Status>(`/api/artwork/${admitted.assetId}/status`, { signal });
        if (status.state === 'USABLE') {
          const preview = await input.api<{ url: string; width: number; height: number; expiresAt: string }>(
            `/api/artwork/${admitted.assetId}/preview`,
            { signal },
          );
          const url = new URL(preview.url);
          if (
            url.protocol !== 'https:' ||
            !Number.isFinite(preview.width) ||
            !Number.isFinite(preview.height) ||
            preview.width <= 0 ||
            preview.height <= 0 ||
            !Number.isFinite(Date.parse(preview.expiresAt)) ||
            Date.parse(preview.expiresAt) <= Date.now()
          )
            throw new Error('Invalid artwork preview');
          return {
            assetId: admitted.assetId,
            url: preview.url,
            aspectRatio: preview.width / preview.height,
            expiresAt: preview.expiresAt,
            assetExpiresAt: status.expiresAt,
          };
        }
        if (status.state === 'REJECTED')
          throw new Error('Artwork was rejected by inspection. Choose a supported, static image.');
        if (status.state === 'DELETED' || status.state === 'DELETING' || Date.parse(status.expiresAt) <= Date.now())
          throw new Error('Artwork expired. Upload it again.');
        onState('Processing artwork');
        await pause(2000, signal);
      }
      throw new Error('Artwork is still processing. Try again later.');
    },
  };
}
