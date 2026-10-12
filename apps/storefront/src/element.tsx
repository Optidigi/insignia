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
        onPreview={() => {}}
        onAssetChange={(asset) => {
          this.dispatchEvent(
            new CustomEvent('insignia-artwork-change', {
              detail: asset ? { assetId: asset.assetId, expiresAt: asset.assetExpiresAt } : null,
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

/** Buyer code is imported only when its trigger is used or a marked cart needs repair. */
export class InsigniaBuyer extends HTMLElement {
  private readonly root = this.attachShadow({ mode: 'open' });
  private generation = 0;
  connectedCallback() {
    this.generation++;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = this.hasAttribute('repair')
      ? 'Review customized cart'
      : (this.getAttribute('trigger-label') ?? 'Customize this product');
    this.root.replaceChildren(button);
    button.addEventListener('click', () => void this.mount(), { once: true });
  }
  private async mount() {
    const generation = this.generation;
    const productId = this.getAttribute('product-id') ?? '';
    const proxyBase = this.getAttribute('proxy-base') ?? '/apps/insignia';
    const cartRoot = this.getAttribute('cart-root') ?? '/';
    if (!/^[1-9][0-9]{0,19}$/.test(productId)) {
      this.root.textContent = 'Customization unavailable';
      return;
    }
    const { BuyerCustomizer } = await import('./customizer');
    if (generation !== this.generation) return;
    render(
      <BuyerCustomizer
        productId={productId}
        proxyBase={proxyBase}
        cartRoot={cartRoot}
        country={this.getAttribute('country') ?? ''}
        marketId={this.getAttribute('market-id') ?? ''}
        repair={this.hasAttribute('repair')}
        triggerLabel={this.getAttribute('trigger-label') ?? 'Customize this product'}
      />,
      this.root,
    );
    this.root.querySelector<HTMLButtonElement>('button')?.click();
  }
  disconnectedCallback() {
    this.generation++;
    render(null, this.root);
  }
}
if (!customElements.get('insignia-buyer')) customElements.define('insignia-buyer', InsigniaBuyer);

export class InsigniaCartRepair extends HTMLElement {
  private readonly root = this.attachShadow({ mode: 'open' });
  private abort?: AbortController;
  private readonly refresh = () => this.load();
  connectedCallback() {
    window.addEventListener('insignia-cart-updated', this.refresh);
    this.load();
  }
  private load() {
    this.abort?.abort();
    const controller = new AbortController();
    this.abort = controller;
    const cartRoot = this.getAttribute('cart-root') ?? '/';
    if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(cartRoot)) return;
    void fetch(`${cartRoot}cart.js`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const cart = await response.json();
        const line = cart.items?.find(
          (item: { properties?: Record<string, unknown> }) =>
            item.properties &&
            (Object.hasOwn(item.properties, '_insignia_quote_v2') ||
              Object.hasOwn(item.properties, '_insignia_member_v2')),
        );
        if (
          !line ||
          controller.signal.aborted ||
          this.abort !== controller ||
          this.root.querySelector('insignia-buyer')
        )
          return;
        const buyer = document.createElement('insignia-buyer');
        for (const attribute of ['proxy-base', 'cart-root', 'country', 'market-id']) {
          const value = this.getAttribute(attribute);
          if (value) buyer.setAttribute(attribute, value);
        }
        buyer.setAttribute('product-id', String(line.product_id));
        buyer.setAttribute('repair', '');
        this.root.replaceChildren(buyer);
      })
      .catch(() => {});
  }
  disconnectedCallback() {
    window.removeEventListener('insignia-cart-updated', this.refresh);
    this.abort?.abort();
    this.root.replaceChildren();
  }
}
if (!customElements.get('insignia-cart-repair')) customElements.define('insignia-cart-repair', InsigniaCartRepair);
