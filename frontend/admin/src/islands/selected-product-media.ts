import { type EditorProductImage, editorProductImageSchema, type PlacementProduct } from '@insignia/contracts';
import { z } from 'zod';
import { authenticatedJson } from '../shared/admin-request.ts';
import { StoredPreviewUnreadableError } from '../shared/stored-preview-error.ts';

const descriptorSchema = z.object({
  image: editorProductImageSchema,
  previewUrl: z.url(),
  expiresAt: z.iso.datetime(),
});
const responseSchema = z.object({ media: z.array(descriptorSchema).max(100) });
type Descriptor = z.infer<typeof descriptorSchema>;

/** Private URLs/bytes live only in memory; durable setup and write journals contain stable media identity URIs. */
export function createSelectedProductMedia(
  productId: string,
  authority: string,
  options: { request?: (path: string, init?: RequestInit) => Promise<unknown>; fetchImpl?: typeof fetch } = {},
) {
  const request = options.request ?? authenticatedJson;
  const fetchImpl = options.fetchImpl ?? fetch;
  const number = /^gid:\/\/shopify\/Product\/([1-9][0-9]*)$/.exec(productId)?.[1];
  if (!number || !/^[a-f0-9]{64}$/.test(authority)) throw new Error('Invalid product authority');
  const lifetime = new AbortController();
  const active = () => lifetime.signal.throwIfAborted();
  async function json(path: string, init: RequestInit = {}) {
    active();
    const value = await request(path, {
      ...init,
      signal: init.signal ? AbortSignal.any([lifetime.signal, init.signal]) : lifetime.signal,
    });
    active();
    return value;
  }
  async function read(url: string) {
    active();
    const response = await fetchImpl(url, {
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(10000)]),
    });
    active();
    return response;
  }
  const endpoint = `/api/admin/products/${number}/media`;
  const originals = new Map<string, EditorProductImage>();
  const visible = new Map<string, EditorProductImage>();
  const objectUrls = new Set<string>();
  /** Ask the server for current preview descriptors; `ids` are upload identities owned by this product. */
  async function describe(ids: readonly string[]) {
    const result = responseSchema.parse(await json(`${endpoint}?ids=${encodeURIComponent(ids.join(','))}`));
    if (
      result.media.length !== ids.length ||
      new Set(result.media.map((entry) => entry.image.id)).size !== ids.length ||
      result.media.some((entry) => !ids.includes(entry.image.id))
    )
      throw new Error('Preview media ownership changed');
    return result.media;
  }
  /**
   * `expiresAt` is the presigned URL's lifetime on the server's clock, so the browser clock is no judge of it
   * (a merchant whose clock runs fast must still be able to use uploads). The storage provider is: a presigned
   * URL that has expired is refused (403, or a blocked cross-origin answer). That asks once for a fresh
   * descriptor of the same photo; a second refusal is final.
   */
  async function prepare(descriptor: Descriptor, refreshed = false): Promise<EditorProductImage> {
    active();
    if (!descriptor.image.id.startsWith('upload_')) throw new Error('Preview media is unavailable');
    let response: Response | undefined;
    try {
      response = await read(descriptor.previewUrl);
    } catch (cause) {
      active();
      if (!(cause instanceof TypeError) || refreshed) throw cause;
    }
    if (!response || response.status === 403) {
      if (refreshed) throw new Error('Private preview unavailable');
      const fresh = (await describe([descriptor.image.id]))[0];
      if (!fresh) throw new Error('Preview media ownership changed');
      return prepare(fresh, true);
    }
    const length = Number(response.headers.get('Content-Length') ?? 0);
    if (!response.ok || !response.headers.get('Content-Type')?.startsWith('image/') || length > 10 * 1024 * 1024)
      throw new Error('Private preview unavailable');
    const blob = await response.blob();
    active();
    if (!blob.size || blob.size > 10 * 1024 * 1024) throw new Error('Private preview unavailable');
    const url = URL.createObjectURL(blob);
    objectUrls.add(url);
    originals.set(descriptor.image.id, descriptor.image);
    const image = { ...descriptor.image, url };
    visible.set(image.id, image);
    return image;
  }
  async function hydrate(images: readonly EditorProductImage[]) {
    active();
    const ids = [...new Set(images.filter((image) => image.id.startsWith('upload_')).map((image) => image.id))];
    if (!ids.length) return [];
    if (ids.length > 100) throw new Error('Preview media library exceeds supported size');
    return Promise.all((await describe(ids)).map((descriptor) => prepare(descriptor)));
  }
  async function upload(prepared: EditorProductImage) {
    active();
    // The selected picker already decodes/downsizes images. Send a bounded PNG to the isolated server inspector.
    let bytes: Blob;
    if (prepared.url.startsWith('data:')) {
      // Decode the picker's local image in memory. fetch(data:) is a connection
      // and is intentionally forbidden by the product page's connect-src policy.
      if (prepared.url.length > 1_000_000) throw new Error('Invalid prepared photo');
      const encoded = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(prepared.url);
      const mimeType = encoded?.[1],
        base64 = encoded?.[2];
      if (!mimeType || !base64) throw new Error('Invalid prepared photo');
      bytes = new Blob([Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))], {
        type: mimeType,
      });
    } else {
      const source = await read(prepared.url);
      if (!source.ok) throw new Error('Image preparation unavailable');
      bytes = await source.blob();
    }
    active();
    const bitmap = await createImageBitmap(bytes);
    let png: Blob;
    try {
      active();
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image preparation unavailable');
      context.drawImage(bitmap, 0, 0);
      png = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('PNG preparation failed'))), 'image/png'),
      );
    } finally {
      bitmap.close();
    }
    active();
    if (!png.size || png.size > 5 * 1024 * 1024) throw new Error('Prepared photo exceeds supported size');
    const result = descriptorSchema.parse(
      await json(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'image/png',
          'Idempotency-Key': prepared.id,
          'X-Insignia-Setup-Authority': authority,
        },
        body: png,
      }),
    );
    // The server already stored this photo; a failed read-back must not read as a failed upload.
    const image = await prepare(result).catch((cause: unknown) => {
      active();
      throw new StoredPreviewUnreadableError({ cause });
    });
    return { ...image, alt: prepared.alt };
  }
  function canonical(product: PlacementProduct): PlacementProduct {
    active();
    const byVisibleUrl = new Map(product.images.map((image) => [image.url, image]));
    const canonicalUrl = (url: string) => {
      const image = byVisibleUrl.get(url);
      if (!image?.id.startsWith('upload_')) return url;
      const original = originals.get(image.id);
      if (!original) throw new Error('Reload owned preview media before saving');
      return original.url;
    };
    return {
      ...product,
      images: product.images.map((image) =>
        image.id.startsWith('upload_') ? { ...image, url: canonicalUrl(image.url) } : image,
      ),
      views: product.views.map((view) => ({
        ...view,
        imageUrl: canonicalUrl(view.imageUrl),
        ...(view.calibration
          ? { calibration: { ...view.calibration, imageUrl: canonicalUrl(view.calibration.imageUrl) } }
          : {}),
      })),
    };
  }
  function display(product: PlacementProduct): PlacementProduct {
    active();
    const byCanonicalUrl = new Map(product.images.map((image) => [image.url, image]));
    const displayUrl = (url: string) => visible.get(byCanonicalUrl.get(url)?.id ?? '')?.url ?? url;
    return {
      ...product,
      images: product.images.map((image) => ({ ...image, url: visible.get(image.id)?.url ?? image.url })),
      views: product.views.map((view) => ({
        ...view,
        imageUrl: displayUrl(view.imageUrl),
        ...(view.calibration
          ? { calibration: { ...view.calibration, imageUrl: displayUrl(view.calibration.imageUrl) } }
          : {}),
      })),
    };
  }
  return {
    hydrate,
    upload,
    canonical,
    display,
    dispose() {
      lifetime.abort();
      for (const url of objectUrls) URL.revokeObjectURL(url);
      objectUrls.clear();
      originals.clear();
      visible.clear();
    },
  };
}
