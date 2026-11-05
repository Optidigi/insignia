export type ArtworkPreview = {
  assetId: string;
  url: string;
  aspectRatio: number;
  expiresAt: string;
  assetExpiresAt: string;
};
export type ArtworkSelection = Pick<ArtworkPreview, 'assetId' | 'assetExpiresAt'>;
export type JsonApi = (path: string, init?: RequestInit) => Promise<unknown>;
export type ArtworkUploadProgress = 'allocating' | 'uploading' | 'processing';
export type ArtworkUploadErrorReason =
  | 'invalid-response'
  | 'expired'
  | 'inspection-rejected'
  | 'processing-timeout'
  | 'file-format-rejected'
  | 'file-size-rejected'
  | 'upload-failed';
export class ArtworkUploadError extends Error {
  readonly reason: ArtworkUploadErrorReason;
  readonly status?: number;

  constructor(reason: ArtworkUploadErrorReason, status?: number) {
    super(reason);
    this.reason = reason;
    this.status = status;
  }
}
function invalidResponse(): ArtworkUploadError {
  return new ArtworkUploadError('invalid-response');
}
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalidResponse();
  return Object.fromEntries(Object.entries(value));
}
function statusResponse(value: unknown) {
  const status = object(value);
  if (typeof status.state !== 'string') throw invalidResponse();
  return { state: status.state, expiresAt: status.expiresAt };
}
function admissionResponse(value: unknown) {
  const admission = object(value);
  const upload = object(admission.upload);
  const headers = object(upload.headers);
  if (
    typeof admission.assetId !== 'string' ||
    !admission.assetId ||
    typeof admission.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(admission.expiresAt)) ||
    Date.parse(admission.expiresAt) <= Date.now() ||
    typeof upload.url !== 'string'
  )
    throw invalidResponse();
  const url = new URL(upload.url);
  if (url.protocol !== 'https:') throw invalidResponse();
  const entries: [string, string][] = [];
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== 'string') throw invalidResponse();
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
    const preview = object(await input.api(`/api/artwork/${assetId}/preview`, { signal }));
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (
      typeof preview.url !== 'string' ||
      typeof preview.width !== 'number' ||
      typeof preview.height !== 'number' ||
      typeof preview.expiresAt !== 'string'
    )
      throw invalidResponse();
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
      throw invalidResponse();
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
    onState: (state: ArtworkUploadProgress) => void,
    signal?: AbortSignal,
  ): Promise<ArtworkPreview> {
    let completionAttempted = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (Date.parse(asset.assetExpiresAt) <= Date.now()) throw new ArtworkUploadError('expired', 410);
      const status = statusResponse(await input.api(`/api/artwork/${asset.assetId}/status`, { signal }));
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (status.state === 'REJECTED') throw new ArtworkUploadError('inspection-rejected', 422);
      if (
        status.state === 'DELETED' ||
        status.state === 'DELETING' ||
        (typeof status.expiresAt === 'string' && Date.parse(status.expiresAt) <= Date.now())
      )
        throw new ArtworkUploadError('expired', 410);
      if (typeof status.expiresAt !== 'string' || !Number.isFinite(Date.parse(status.expiresAt)))
        throw invalidResponse();
      if (status.state === 'USABLE') return readPreview(asset.assetId, status.expiresAt, signal);
      if (!['UPLOADING', 'QUEUED', 'INSPECTING', 'PROMOTING'].includes(status.state)) throw invalidResponse();
      if (status.state === 'UPLOADING' && !completionAttempted) {
        completionAttempted = true;
        await input.api(`/api/artwork/${asset.assetId}/complete`, {
          method: 'POST',
          // Empty JSON API requests must not be classified as form submissions behind HTTPS proxies.
          headers: { 'Content-Type': 'application/json' },
          signal,
        });
      }
      onState('processing');
      await pause(2000, signal);
    }
    throw new ArtworkUploadError('processing-timeout');
  }
  return {
    async resume(
      asset: ArtworkSelection,
      onState: (state: ArtworkUploadProgress) => void,
      signal?: AbortSignal,
    ): Promise<ArtworkPreview> {
      return awaitPending(asset, onState, signal);
    },
    async renew(asset: ArtworkPreview, signal?: AbortSignal): Promise<ArtworkPreview> {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (Date.parse(asset.assetExpiresAt) <= Date.now()) throw new ArtworkUploadError('expired', 410);
      const status = statusResponse(await input.api(`/api/artwork/${asset.assetId}/status`, { signal }));
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (
        status.state !== 'USABLE' ||
        typeof status.expiresAt !== 'string' ||
        !Number.isFinite(Date.parse(status.expiresAt)) ||
        Date.parse(status.expiresAt) <= Date.now()
      )
        throw new ArtworkUploadError('expired', 410);
      return readPreview(asset.assetId, status.expiresAt, signal);
    },
    async upload(
      file: File,
      onState: (state: ArtworkUploadProgress) => void,
      signal?: AbortSignal,
    ): Promise<ArtworkPreview> {
      if (!['image/svg+xml', 'image/png', 'image/jpeg'].includes(file.type))
        throw new ArtworkUploadError('file-format-rejected');
      if (file.size < 1 || file.size > 5 * 1024 * 1024) throw new ArtworkUploadError('file-size-rejected');
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      onState('allocating');
      const admitted = admissionResponse(
        await input.api('/api/artwork', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contentType: file.type, byteLength: file.size }),
          signal,
        }),
      );
      onState('uploading');
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
      if (!response.ok) throw new ArtworkUploadError('upload-failed');
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
