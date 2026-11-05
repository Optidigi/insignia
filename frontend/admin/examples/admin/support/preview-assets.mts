const iconAssetPath = /^\/__preview\/icons\/(icons|experimental)\/([a-f0-9]{5})\.svg$/;
const assetBodyLimit = 32 * 1024;
const assetTimeoutMs = 4_000;
const assetCacheLimit = 32;

export type PreviewIconAsset = { namespace: 'icons' | 'experimental'; hash: string };

export function parsePreviewIconAsset(pathname: string, search: string): PreviewIconAsset | null {
  if (search) return null;
  const match = iconAssetPath.exec(pathname);
  const namespace = match?.[1];
  const hash = match?.[2];
  if (namespace !== 'icons' && namespace !== 'experimental') return null;
  if (!hash) return null;
  return { namespace, hash };
}

async function boundedSvg(response: Response): Promise<Buffer> {
  if (!response.ok || response.status !== 200) throw new Error('Preview icon fetch failed');
  if (response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'image/svg+xml')
    throw new Error('Preview icon response is not SVG');
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > assetBodyLimit) {
    await response.body?.cancel();
    throw new Error('Preview icon response exceeded its size limit');
  }
  if (!response.body) throw new Error('Preview icon response has no body');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > assetBodyLimit) {
        await reader.cancel();
        throw new Error('Preview icon response exceeded its size limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = Buffer.concat(chunks, length);
  const svg = body
    .toString('utf8')
    .trimStart()
    .replace(/^<\?xml[^>]*>\s*/i, '');
  if (!svg.startsWith('<svg') || !svg.includes('</svg>')) throw new Error('Preview icon response is invalid SVG');
  return body;
}

/** Small, successful-response-only cache for fixed public Polaris assets. */
export function createPreviewIconLoader(fetcher: typeof fetch = fetch) {
  const cache = new Map<string, Promise<Buffer>>();
  return (asset: PreviewIconAsset): Promise<Buffer> => {
    const key = `${asset.namespace}/${asset.hash}`;
    let result = cache.get(key);
    if (result) return result.then((body) => Buffer.from(body));

    while (cache.size >= assetCacheLimit) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }

    const url = `https://cdn.shopify.com/shopifycloud/admin-ui-foundations/${asset.namespace}/${asset.hash}.svg`;
    result = fetcher(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(assetTimeoutMs) }).then(
      boundedSvg,
    );
    cache.set(key, result);
    result.catch(() => {
      if (cache.get(key) === result) cache.delete(key);
    });
    return result.then((body) => Buffer.from(body));
  };
}
