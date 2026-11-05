import { overlayPlacementProductSummaries, readPlacementSetupExample } from './placement-preview-storage.mts';

/** Simulate storage upload/inspection locally; all uploaded originals remain download-only. */
const root = globalThis;
const fetchOriginal = root.fetch.bind(root);
// Cross-origin navigation leaves the demo service worker's scope. Mirror only
// reserved original-download navigation onto its loopback attachment response.
const openOriginal = root.open.bind(root);
root.open = (value, target, features) => {
  if (value) {
    const url = new URL(value, location.href);
    if (
      target === '_self' &&
      url.origin === 'https://insignia-order-demo.invalid' &&
      /^\/asset\/[0-9a-f-]+\/download$/.test(url.pathname)
    )
      return openOriginal(`/__preview/demo${url.pathname}`, target, features);
  }
  return openOriginal(value, target, features);
};
function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    if (input instanceof Request) return new URL(input.url, location.href);
    return new URL(input instanceof URL ? input.href : input, location.href);
  } catch {
    return null;
  }
}

function requestSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal | null {
  if (init && 'signal' in init) return init.signal ?? null;
  return input instanceof Request ? input.signal : null;
}

function abortIfRequested(signal: AbortSignal | null): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

root.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = requestUrl(input);
  const upload =
    url?.origin === 'https://insignia-order-demo.invalid' && url.pathname.match(/^\/upload\/([0-9a-f-]+)$/);
  if (upload && init?.method === 'PUT' && init.body instanceof Blob) {
    const original = init.body;
    const localPath = `/__preview/demo/upload/${upload[1]}`;
    const response = await fetchOriginal(localPath, { ...init, credentials: 'omit' });
    if (!response.ok) return response;
    // Browser image decoding cannot execute SVG scripts in an image context.
    // This is a UI simulation, not qualification of the production inspection service.
    const objectUrl = URL.createObjectURL(original);
    try {
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      if (image.width > 12000 || image.height > 12000 || image.width * image.height > 40000000)
        throw new Error('Image dimensions exceeded');
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image preview unavailable');
      let scale = Math.min(1, 1024 / Math.max(image.width, image.height));
      let derivative: Blob;
      do {
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        derivative = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Image preview unavailable'))), 'image/png'),
        );
        scale /= 2;
      } while (derivative.size > 2 * 1024 * 1024);
      return await fetchOriginal(`/__preview/demo/preview-upload/${upload[1]}`, {
        method: 'PUT',
        body: derivative,
        credentials: 'omit',
        signal: init.signal,
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  const response = await fetchOriginal(input, init);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (
    !response.ok ||
    method !== 'GET' ||
    !url ||
    url.origin !== location.origin ||
    url.pathname !== '/api/admin/products'
  )
    return response;

  const signal = requestSignal(input, init);
  let payload: unknown;
  try {
    payload = await response.clone().json();
    abortIfRequested(signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    return response;
  }
  const transformed = overlayPlacementProductSummaries(payload, readPlacementSetupExample());
  if (transformed === payload) return response;

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(JSON.stringify(transformed), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
document.addEventListener(
  'click',
  (event) => {
    const link = event
      .composedPath()
      .find((element): element is HTMLAnchorElement => element instanceof HTMLAnchorElement);
    if (!link) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== 'https://insignia-order-demo.invalid' || !/^\/asset\/[0-9a-f-]+\/download$/.test(url.pathname))
      return;
    event.preventDefault();
    const download = document.createElement('a');
    download.href = `/__preview/demo${url.pathname}`;
    download.download = 'artwork';
    download.click();
  },
  true,
);
