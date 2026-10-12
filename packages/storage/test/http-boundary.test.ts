import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { createR2ArtworkStorage } from '../src/index.js';

const clock = () => new Date('2026-10-12T12:00:00Z');
const keyId = 'test-access-key';
const secret = 'test-secret';
const close: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of close.splice(0)) await dispose();
});
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const hmac = (key: string | Uint8Array, value: string) => createHmac('sha256', key).update(value).digest();
const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
// Independent test-side verifier, not another production signer. Validates actual requests at HTTP ingress.
function verified(method: string, url: URL, headers: Headers, body: Uint8Array, currentTime: Date): boolean {
  const querySigned = url.searchParams.has('X-Amz-Signature');
  const authorization = headers.get('authorization') ?? '';
  const credential = querySigned
    ? url.searchParams.get('X-Amz-Credential')
    : /Credential=([^,]+)/.exec(authorization)?.[1];
  const signedHeaders = querySigned
    ? url.searchParams.get('X-Amz-SignedHeaders')
    : /SignedHeaders=([^,]+)/.exec(authorization)?.[1];
  const signature = querySigned
    ? url.searchParams.get('X-Amz-Signature')
    : /Signature=([a-f0-9]+)/.exec(authorization)?.[1];
  if (!credential || !signedHeaders || !signature) return false;
  const [accessKey, date, region, service, terminal] = credential.split('/');
  if (accessKey !== keyId || region !== 'auto' || service !== 's3' || terminal !== 'aws4_request') return false;
  const datetime = querySigned ? url.searchParams.get('X-Amz-Date') : headers.get('x-amz-date');
  if (!datetime || !date) return false;
  if (querySigned) {
    const ttl = Number(url.searchParams.get('X-Amz-Expires'));
    const issued = Date.parse(datetime.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
    if (ttl < 1 || ttl > 300 || currentTime.getTime() >= issued + ttl * 1000) return false;
  }
  const params = [...url.searchParams]
    .filter(([name]) => name !== 'X-Amz-Signature')
    .map(([name, value]): [string, string] => [encode(name), encode(value)]);
  // SigV4 uses byte ordering, not locale ordering.
  params.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  const canonicalHeaders = signedHeaders
    .split(';')
    .map((name) => `${name}:${(name === 'host' ? url.host : (headers.get(name) ?? '')).trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const payload = querySigned ? 'UNSIGNED-PAYLOAD' : (headers.get('x-amz-content-sha256') ?? hash(body));
  if (!querySigned && payload !== hash(body)) return false;
  const canonical = [
    method,
    url.pathname,
    params.map(([name, value]) => `${name}=${value}`).join('&'),
    canonicalHeaders,
    signedHeaders,
    payload,
  ].join('\n');
  const scope = `${date}/${region}/${service}/aws4_request`;
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), terminal);
  const expected = hmac(signingKey, ['AWS4-HMAC-SHA256', datetime, scope, hash(canonical)].join('\n')).toString('hex');
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
async function boundary() {
  const objects = new Map<string, Uint8Array>();
  let denied = 0;
  let currentTime = clock();
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers))
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(',') : value);
    if (
      !verified(request.method ?? '', url, headers, body, currentTime) ||
      !url.pathname.startsWith('/test-bucket/m6/')
    ) {
      denied++;
      response.writeHead(403).end();
      return;
    }
    if (request.method === 'PUT') {
      if (request.headers['if-none-match'] === '*' && objects.has(url.pathname)) {
        response.writeHead(412).end();
        return;
      }
      objects.set(url.pathname, Uint8Array.from(body));
      response.writeHead(200).end();
      return;
    }
    if (request.method === 'DELETE') {
      objects.delete(url.pathname);
      response.writeHead(204).end();
      return;
    }
    if (request.method === 'GET') {
      const object = objects.get(url.pathname);
      if (!object) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'content-type': url.searchParams.get('response-content-type') ?? 'application/octet-stream',
        ...(url.searchParams.has('response-content-disposition')
          ? { 'content-disposition': url.searchParams.get('response-content-disposition') ?? '' }
          : {}),
      });
      response.end(object);
      return;
    }
    response.writeHead(405).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server address');
  close.push(
    () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  );
  const storage = createR2ArtworkStorage({
    endpoint: `http://127.0.0.1:${address.port}`,
    bucket: 'test-bucket',
    prefix: 'm6',
    accessKeyId: keyId,
    secretAccessKey: secret,
    clock,
  });
  return {
    storage,
    denied: () => denied,
    advance: (milliseconds: number) => {
      currentTime = new Date(currentTime.getTime() + milliseconds);
    },
  };
}
it('verifies MIME-bound direct upload, reusable quarantine and exact-byte write-once promotion over HTTP', async () => {
  const { storage, denied } = await boundary();
  const grant = await storage.presignUpload({
    key: 'quarantine/shop/session',
    contentType: 'image/png',
    byteLength: 3,
    expiresAt: new Date(clock().getTime() + 60_000),
  });
  expect(
    (await fetch(grant.url, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: new Uint8Array([9]) }))
      .status,
  ).toBe(403);
  expect(
    (await fetch(grant.url, { method: 'PUT', headers: grant.headers, body: new Uint8Array([1, 2, 3]) })).status,
  ).toBe(200);
  const inspected = await storage.read({ key: 'quarantine/shop/session', maxBytes: 20 });
  expect(
    (await fetch(grant.url, { method: 'PUT', headers: grant.headers, body: new Uint8Array([9, 8, 7]) })).status,
  ).toBe(200);
  await storage.putImmutable({ key: 'originals/shop/revision', bytes: inspected, contentType: 'image/png' });
  await storage.putImmutable({ key: 'originals/shop/revision', bytes: inspected, contentType: 'image/png' });
  await expect(
    storage.putImmutable({
      key: 'originals/shop/revision',
      bytes: new Uint8Array([9, 8, 7]),
      contentType: 'image/png',
    }),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  const originalUrl = await storage.presignRead({
    key: 'originals/shop/revision',
    expiresAt: new Date(clock().getTime() + 60_000),
    downloadFilename: 'artwork.png',
  });
  const original = await fetch(originalUrl);
  expect(original.headers.get('content-disposition')).toBe('attachment; filename="artwork.png"');
  expect(original.headers.get('content-type')).toBe('application/octet-stream');
  expect(new Uint8Array(await original.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  await storage.remove({ key: 'quarantine/shop/session' });
  await storage.remove({ key: 'quarantine/shop/session' });
  await expect(storage.read({ key: 'quarantine/shop/session', maxBytes: 20 })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  expect(denied()).toBe(1);
});
it('denies altered key and TTL in an actual presigned HTTP request', async () => {
  const { storage } = await boundary();
  const grant = await storage.presignUpload({
    key: 'quarantine/shop/session',
    contentType: 'image/png',
    byteLength: 3,
    expiresAt: new Date(clock().getTime() + 60_000),
  });
  const url = new URL(grant.url);
  url.pathname = url.pathname.replace('/quarantine/', '/originals/');
  expect((await fetch(url, { method: 'PUT', headers: grant.headers, body: new Uint8Array([1]) })).status).toBe(403);
  const expired = new URL(grant.url);
  expired.searchParams.set('X-Amz-Expires', '0');
  expect((await fetch(expired, { method: 'PUT', headers: grant.headers, body: new Uint8Array([1]) })).status).toBe(403);
});

it('rejects an unchanged signed URL after its actual expiry at HTTP ingress', async () => {
  const { storage, advance } = await boundary();
  const grant = await storage.presignUpload({
    key: 'quarantine/shop/session',
    contentType: 'image/png',
    byteLength: 3,
    expiresAt: new Date(clock().getTime() + 60_000),
  });
  advance(60_000);
  expect((await fetch(grant.url, { method: 'PUT', headers: grant.headers, body: new Uint8Array([1]) })).status).toBe(
    403,
  );
});

it('rejects bodies shorter or larger than the signed declaration at HTTP ingress', async () => {
  const { storage, denied } = await boundary();
  const grant = await storage.presignUpload({
    key: 'quarantine/shop/bounded',
    contentType: 'image/png',
    byteLength: 3,
    expiresAt: new Date(clock().getTime() + 60_000),
  });
  // The transport supplies Content-Length, as it does for known-length File/Blob uploads.
  for (const bytes of [new Uint8Array([1]), new Uint8Array([1, 2, 3, 4])])
    expect((await fetch(grant.url, { method: 'PUT', headers: grant.headers, body: bytes })).status).toBe(403);
  expect(denied()).toBe(2);
  await expect(storage.read({ key: 'quarantine/shop/bounded', maxBytes: 5 })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  expect(
    (await fetch(grant.url, { method: 'PUT', headers: grant.headers, body: new Blob([new Uint8Array([1, 2, 3])]) }))
      .status,
  ).toBe(200);
});

it('rejects chunked upload without the signed Content-Length', async () => {
  const { storage } = await boundary();
  const grant = await storage.presignUpload({
    key: 'quarantine/shop/chunked',
    contentType: 'image/png',
    byteLength: 3,
    expiresAt: new Date(clock().getTime() + 60_000),
  });
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(grant.url, { method: 'PUT', headers: grant.headers }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.write(new Uint8Array([1, 2, 3]));
    request.end();
  });
  expect(status).toBe(403);
});
