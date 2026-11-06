import { render } from 'preact';
import {
  buildCustomerPreviewConfig,
  readArtworkPreviewMessage,
} from '../../../../frontend/designer/src/artwork-preview-config';
import { Designer } from '../../../../frontend/designer/src/index';
import type { DesignerPorts } from '../../../../frontend/designer/src/runtime';

/** Same-origin, nonce-bound unsaved merchant preview. It has no production upload/cart authority. */
export function mountMerchantDesignerPreview() {
  const query = new URL(location.href).searchParams;
  const nonce = query.get('adminPreview');
  const origin = query.get('adminOrigin');
  const opener = window.opener;
  if (!opener || origin !== location.origin || !nonce || !/^[a-f0-9-]{16,128}$/i.test(nonce)) return;
  const urls = new Set<string>();
  let received = false;
  const ports: DesignerPorts = {
    artwork: {
      async upload(file, request) {
        if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const url = URL.createObjectURL(file);
        urls.add(url);
        try {
          // Image decoding supports viewBox-only SVGs as well as raster files.
          const image = new Image();
          image.src = url;
          await image.decode();
          if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          return {
            id: crypto.randomUUID(),
            name: file.name,
            url,
            width: image.naturalWidth,
            height: image.naturalHeight,
          };
        } catch (error) {
          URL.revokeObjectURL(url);
          urls.delete(url);
          throw error;
        }
      },
    },
    cart: {
      async commit() {
        throw new Error('Merchant artwork preview cannot modify a cart');
      },
    },
  };
  function receive(event: MessageEvent) {
    if (received || event.source !== opener || event.origin !== origin) return;
    const message = readArtworkPreviewMessage(event.data, nonce!);
    if (message.status !== 'ready') return;
    const config = buildCustomerPreviewConfig(message.product, origin!, undefined, message.currency ?? 'EUR');
    received = true;
    render(
      <Designer
        config={config}
        ports={ports}
        previewOnly
        isOpen
        locale={document.documentElement.lang || 'en'}
        onOpenChange={(open) => {
          if (!open) window.close();
        }}
      />,
      document.body,
    );
  }
  window.addEventListener('message', receive);
  window.addEventListener(
    'pagehide',
    () => {
      window.removeEventListener('message', receive);
      for (const url of urls) URL.revokeObjectURL(url);
    },
    { once: true },
  );
  opener.postMessage({ type: 'insignia:customer-preview:ready', nonce }, origin);
}
