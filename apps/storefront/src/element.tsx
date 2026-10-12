import { render } from 'preact';
import { useState } from 'preact/hooks';
import GuestArtworkUpload from '../../web/src/islands/GuestArtworkUpload';

const style = `:host{display:block;contain:content;font:16px system-ui,sans-serif;color:#17212b}button{font:inherit;padding:.5rem .75rem}output{margin-inline-start:.75rem}`;

function LocalPreview({ host }: { host: HTMLElement }) {
  const [count, setCount] = useState(0);
  return (
    <section aria-label="Insignia local preview">
      <p>Local storefront interaction test. No cart or pricing actions.</p>
      <button
        type="button"
        onClick={() => {
          const next = count + 1;
          setCount(next);
          host.dispatchEvent(
            new CustomEvent('insignia-local-change', { detail: { count: next }, bubbles: false, composed: false }),
          );
        }}
      >
        Count locally
      </button>
      <output aria-live="polite">{count}</output>
    </section>
  );
}

export class InsigniaLocalPreview extends HTMLElement {
  private readonly root = this.attachShadow({ mode: 'open' });

  connectedCallback() {
    if (!this.root.querySelector('style')) {
      const sheet = document.createElement('style');
      sheet.textContent = style;
      this.root.append(sheet);
    }
    render(<LocalPreview host={this} />, this.root);
  }

  disconnectedCallback() {
    render(null, this.root);
  }
}

if (!customElements.get('insignia-local-preview')) {
  customElements.define('insignia-local-preview', InsigniaLocalPreview);
}

/** Secure M6 artwork input only; purchase and cart integration belong to M7. */
export class InsigniaArtworkUpload extends HTMLElement {
  private readonly root = this.attachShadow({ mode: 'open' });
  connectedCallback() {
    const productId = this.getAttribute('product-id') ?? '';
    const proxyBase = this.getAttribute('proxy-base') ?? '/apps/insignia';
    if (!/^[1-9][0-9]{0,19}$/.test(productId) || !/^\/apps\/[a-z0-9-]{1,64}$/.test(proxyBase)) {
      this.root.textContent = 'Artwork configuration unavailable';
      return;
    }
    render(
      <GuestArtworkUpload
        proxyBase={proxyBase}
        productId={productId}
        onPreview={(preview) => {
          this.dispatchEvent(
            new CustomEvent('insignia-artwork-change', {
              detail: preview ? { assetId: preview.assetId, expiresAt: preview.assetExpiresAt } : null,
              bubbles: false,
              composed: false,
            }),
          );
        }}
      />,
      this.root,
    );
  }
  disconnectedCallback() {
    render(null, this.root);
  }
}
if (!customElements.get('insignia-artwork-upload'))
  customElements.define('insignia-artwork-upload', InsigniaArtworkUpload);
