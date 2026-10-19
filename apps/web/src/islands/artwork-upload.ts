export type ArtworkPreview = {
  assetId: string;
  url: string;
  aspectRatio: number;
  expiresAt: string;
  assetExpiresAt: string;
};
export type ArtworkSelection = Pick<ArtworkPreview, 'assetId' | 'assetExpiresAt'>;
export type JsonApi = (path: string, init?: RequestInit) => Promise<unknown>;
function object(value: unknown, message: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return Object.fromEntries(Object.entries(value));
}
function statusResponse(value: unknown) {
  const status = object(value, 'Invalid artwork status');
  if (typeof status.state !== 'string') throw new Error('Invalid artwork status');
  return { state: status.state, expiresAt: status.expiresAt };
}
function admissionResponse(value: unknown) {
  const invalid = 'Invalid private upload';
  const admission = object(value, invalid);
  const upload = object(admission.upload, invalid);
  const headers = object(upload.headers, invalid);
  if (
    typeof admission.assetId !== 'string' ||
    !admission.assetId ||
    typeof admission.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(admission.expiresAt)) ||
    Date.parse(admission.expiresAt) <= Date.now() ||
    typeof upload.url !== 'string'
  )
    throw new Error(invalid);
  const url = new URL(upload.url);
  if (url.protocol !== 'https:') throw new Error(invalid);
  const entries: [string, string][] = [];
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== 'string') throw new Error(invalid);
    entries.push([name, value]);
  }
  return {
    assetId: admission.assetId,
    expiresAt: admission.expiresAt,
    upload: { url: upload.url, headers: Object.fromEntries(entries) },
  };
}
export function createArtworkUpload(input: {
  api: JsonApi;
  onPending?: (asset: ArtworkSelection) => void;
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
  async function readPreview(assetId: string, assetExpiresAt: string, signal?: AbortSignal): Promise<ArtworkPreview> {
    const preview = object(await input.api(`/api/artwork/${assetId}/preview`, { signal }), 'Invalid artwork preview');
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (
      typeof preview.url !== 'string' ||
      typeof preview.width !== 'number' ||
      typeof preview.height !== 'number' ||
      typeof preview.expiresAt !== 'string'
    )
      throw new Error('Invalid artwork preview');
    const url = new URL(preview.url);
    if (
      url.protocol !== 'https:' ||
      !Number.isFinite(preview.width) ||
      !Number.isFinite(preview.height) ||
      preview.width <= 0 ||
      preview.height <= 0 ||
      !Number.isFinite(Date.parse(preview.expiresAt)) ||
      Date.parse(preview.expiresAt) <= Date.now() ||
      !Number.isFinite(Date.parse(assetExpiresAt)) ||
      Date.parse(assetExpiresAt) <= Date.now()
    )
      throw new Error('Invalid artwork preview');
    return {
      assetId,
      url: url.href,
      aspectRatio: preview.width / preview.height,
      expiresAt: preview.expiresAt,
      assetExpiresAt,
    };
  }
  async function awaitPending(
    asset: ArtworkSelection,
    onState: (state: string) => void,
    signal?: AbortSignal,
  ): Promise<ArtworkPreview> {
    let completionAttempted = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (Date.parse(asset.assetExpiresAt) <= Date.now())
        throw Object.assign(new Error('Artwork expired. Upload it again.'), { status: 410 });
      const status = statusResponse(await input.api(`/api/artwork/${asset.assetId}/status`, { signal }));
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (status.state === 'REJECTED')
        throw Object.assign(new Error('Artwork was rejected by inspection. Choose a supported, static image.'), {
          status: 422,
        });
      if (
        status.state === 'DELETED' ||
        status.state === 'DELETING' ||
        (typeof status.expiresAt === 'string' && Date.parse(status.expiresAt) <= Date.now())
      )
        throw Object.assign(new Error('Artwork expired. Upload it again.'), { status: 410 });
      if (typeof status.expiresAt !== 'string' || !Number.isFinite(Date.parse(status.expiresAt)))
        throw new Error('Invalid artwork status');
      if (status.state === 'USABLE') return readPreview(asset.assetId, status.expiresAt, signal);
      if (!['UPLOADING', 'QUEUED', 'INSPECTING', 'PROMOTING'].includes(status.state))
        throw new Error('Invalid artwork status');
      if (status.state === 'UPLOADING' && !completionAttempted) {
        completionAttempted = true;
        await input.api(`/api/artwork/${asset.assetId}/complete`, {
          method: 'POST',
          // Empty JSON API requests must not be classified as form submissions behind HTTPS proxies.
          headers: { 'Content-Type': 'application/json' },
          signal,
        });
      }
      onState('Processing artwork');
      await pause(2000, signal);
    }
    throw new Error('Artwork is still processing. Try again later.');
  }
  return {
    async resume(
      asset: ArtworkSelection,
      onState: (state: string) => void,
      signal?: AbortSignal,
    ): Promise<ArtworkPreview> {
      return awaitPending(asset, onState, signal);
    },
    async renew(asset: ArtworkPreview, signal?: AbortSignal): Promise<ArtworkPreview> {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (Date.parse(asset.assetExpiresAt) <= Date.now())
        throw Object.assign(new Error('Artwork expired. Upload it again.'), { status: 410 });
      const status = statusResponse(await input.api(`/api/artwork/${asset.assetId}/status`, { signal }));
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (
        status.state !== 'USABLE' ||
        typeof status.expiresAt !== 'string' ||
        !Number.isFinite(Date.parse(status.expiresAt)) ||
        Date.parse(status.expiresAt) <= Date.now()
      )
        throw Object.assign(new Error('Artwork is no longer usable. Upload it again.'), { status: 410 });
      return readPreview(asset.assetId, status.expiresAt, signal);
    },
    async upload(file: File, onState: (state: string) => void, signal?: AbortSignal): Promise<ArtworkPreview> {
      if (
        !['image/svg+xml', 'image/png', 'image/jpeg'].includes(file.type) ||
        file.size < 1 ||
        file.size > 5 * 1024 * 1024
      )
        throw new Error('Choose an SVG, PNG or JPEG up to 5 MiB.');
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      onState('Allocating private upload');
      const admitted = admissionResponse(
        await input.api('/api/artwork', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contentType: file.type, byteLength: file.size }),
          signal,
        }),
      );
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
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      input.onPending?.({ assetId: admitted.assetId, assetExpiresAt: admitted.expiresAt });
      await input.api(`/api/artwork/${admitted.assetId}/complete`, {
        method: 'POST',
        // Empty JSON API requests must not be classified as form submissions behind HTTPS proxies.
        headers: { 'Content-Type': 'application/json' },
        signal,
      });
      return awaitPending({ assetId: admitted.assetId, assetExpiresAt: admitted.expiresAt }, onState, signal);
    },
  };
}
