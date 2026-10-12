import { createHash } from 'node:crypto';
import { AwsClient } from 'aws4fetch';

export { loadArtworkStorageProfile } from './profile.js';

export class ArtworkStorageError extends Error {
  constructor(public readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'TOO_LARGE' | 'CONFLICT' | 'UNAVAILABLE') {
    super(`Artwork storage: ${code}`);
    this.name = 'ArtworkStorageError';
  }
}

function invalid(): never {
  throw new ArtworkStorageError('INVALID_INPUT');
}
function path(value: string): string {
  if (
    value.length > 512 ||
    !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(value) ||
    value.split('/').some((part) => part === '.' || part === '..')
  )
    invalid();
  return value;
}
function mime(value: string): string {
  if (!['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'].includes(value))
    invalid();
  return value;
}

/** Server-only private R2 boundary. Callers authorize resource IDs before resolving keys. */
export function createR2ArtworkStorage(config: {
  endpoint: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  fetchImpl?: typeof fetch;
  clock?: () => Date;
}) {
  const endpoint = new URL(config.endpoint);
  const local = endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  const r2 =
    endpoint.protocol === 'https:' &&
    /^[a-f0-9]{32}(?:\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com$/.test(endpoint.hostname) &&
    !endpoint.port;
  if (
    (!r2 && !local) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== '/'
  )
    invalid();
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket) || !config.accessKeyId || !config.secretAccessKey)
    invalid();
  const prefix = path(config.prefix);
  const aws = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: 'auto',
    service: 's3',
  });
  const fetchImpl = config.fetchImpl ?? fetch;
  const clock = config.clock ?? (() => new Date());
  function objectUrl(key: string): URL {
    return new URL(`/${config.bucket}/${prefix}/${path(key)}`, endpoint);
  }
  function date(): string {
    return clock()
      .toISOString()
      .replace(/[:-]|\.\d{3}/g, '');
  }
  async function request(
    key: string,
    method: string,
    headers: Record<string, string> = {},
    bytes?: Uint8Array,
    signal?: AbortSignal,
  ): Promise<Response> {
    const signed = await aws.sign(objectUrl(key), {
      method,
      headers: {
        ...headers,
        'x-amz-content-sha256': createHash('sha256')
          .update(bytes ?? new Uint8Array())
          .digest('hex'),
      },
      ...(bytes ? { body: Buffer.from(bytes) } : {}),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
      aws: { datetime: date(), allHeaders: true },
    });
    // AwsClient.fetch retries 5xx; single dispatch lets callers reconcile uncertain effects.
    try {
      return await fetchImpl(new Request(signed, { redirect: 'error' }));
    } catch {
      throw new ArtworkStorageError('UNAVAILABLE');
    }
  }
  async function presign(
    key: string,
    expiresAt: Date,
    method: string,
    headers: Record<string, string>,
    query: Record<string, string> = {},
  ): Promise<string> {
    const seconds = Math.floor((expiresAt.getTime() - clock().getTime()) / 1000);
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 300) invalid();
    const url = objectUrl(key);
    url.searchParams.set('X-Amz-Expires', String(seconds));
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    const signed = await aws.sign(url, {
      method,
      headers,
      aws: { signQuery: true, allHeaders: true, datetime: date() },
    });
    return signed.url;
  }
  async function read({
    key,
    maxBytes,
    signal,
  }: {
    key: string;
    maxBytes: number;
    signal?: AbortSignal;
  }): Promise<Uint8Array> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 5 * 1024 * 1024) invalid();
    const response = await request(key, 'GET', {}, undefined, signal);
    if (!response.ok) {
      await response.body?.cancel();
      throw new ArtworkStorageError(response.status === 404 ? 'NOT_FOUND' : 'UNAVAILABLE');
    }
    const length = response.headers.get('content-length');
    if (length !== null && (/^\d+$/.test(length) ? Number(length) > maxBytes : true)) {
      await response.body?.cancel();
      throw new ArtworkStorageError('TOO_LARGE');
    }
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        if (signal?.aborted) throw new ArtworkStorageError('UNAVAILABLE');
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > maxBytes) throw new ArtworkStorageError('TOO_LARGE');
        chunks.push(part.value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error instanceof ArtworkStorageError ? error : new ArtworkStorageError('UNAVAILABLE');
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }
  return {
    read,
    async presignUpload({ key, contentType, expiresAt }: { key: string; contentType: string; expiresAt: Date }) {
      if (!key.startsWith('quarantine/')) invalid();
      const headers = { 'content-type': mime(contentType) };
      return { url: await presign(key, expiresAt, 'PUT', headers), headers };
    },
    async putImmutable({ key, bytes, contentType }: { key: string; bytes: Uint8Array; contentType: string }) {
      if (
        !(key.startsWith('originals/') || key.startsWith('previews/')) ||
        bytes.length < 1 ||
        bytes.length > 5 * 1024 * 1024
      )
        invalid();
      const type = mime(contentType);
      if (key.startsWith('previews/') && !['image/png', 'image/webp', 'image/jpeg'].includes(type)) invalid();
      // Freeze the exact inspected bytes before awaiting network work.
      const frozen = Uint8Array.from(bytes);
      let response: Response | undefined;
      try {
        response = await request(
          key,
          'PUT',
          {
            'if-none-match': '*',
            'content-type': key.startsWith('originals/') ? 'application/octet-stream' : type,
            'content-disposition': key.startsWith('originals/') ? 'attachment; filename="artwork"' : 'inline',
            'cache-control': 'private, no-store',
          },
          frozen,
        );
      } catch (error) {
        if (!(error instanceof ArtworkStorageError) || error.code !== 'UNAVAILABLE') throw error;
      }
      if (response?.ok) {
        await response.body?.cancel();
        return;
      }
      const status = response?.status;
      await response?.body?.cancel();
      if (status !== undefined && status !== 412 && status !== 409 && status < 500)
        throw new ArtworkStorageError('UNAVAILABLE');
      // A conflict or lost response succeeds only on actual byte equality, never ETag assumptions.
      let observed: Uint8Array;
      try {
        observed = await read({ key, maxBytes: frozen.length });
      } catch {
        throw new ArtworkStorageError('UNAVAILABLE');
      }
      if (observed.length !== frozen.length || observed.some((byte, index) => byte !== frozen[index]))
        throw new ArtworkStorageError('CONFLICT');
    },
    async remove({ key }: { key: string }) {
      const response = await request(key, 'DELETE');
      await response.body?.cancel();
      if (!response.ok && response.status !== 404) throw new ArtworkStorageError('UNAVAILABLE');
    },
    async presignRead({
      key,
      expiresAt,
      downloadFilename,
    }: {
      key: string;
      expiresAt: Date;
      downloadFilename?: string;
    }) {
      if (downloadFilename !== undefined) {
        if (!key.startsWith('originals/') || !/^[a-zA-Z0-9][a-zA-Z0-9_. -]{0,119}$/.test(downloadFilename)) invalid();
        return presign(
          key,
          expiresAt,
          'GET',
          {},
          {
            'response-content-type': 'application/octet-stream',
            'response-content-disposition': `attachment; filename="${downloadFilename}"`,
          },
        );
      }
      if (!/^previews\/.+\.(png|webp|jpe?g)$/.test(key)) invalid();
      const type = key.endsWith('.png') ? 'image/png' : key.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
      return presign(
        key,
        expiresAt,
        'GET',
        {},
        { 'response-content-type': type, 'response-content-disposition': 'inline' },
      );
    },
  };
}
