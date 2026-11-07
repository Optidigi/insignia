import { render } from 'preact';
import { connectThemeIntegration, styleThemeTrigger } from './theme-integration';

/** Buyer code is imported only when its trigger is used or a marked cart needs repair. */
export class InsigniaBuyer extends HTMLElement {
  private readonly root = this.attachShadow({ mode: 'open' });
  private generation = 0;
  private liveFrame?: { open(): boolean; destroy(): void };
  private mounting = false;
  private readonly triggerClick = () => void this.mount();
  connectedCallback() {
    this.generation++;
    this.style.display = 'contents';
    const button = this.querySelector<HTMLButtonElement>('button[slot="trigger"]') ?? document.createElement('button');
    button.type = 'button';
    button.slot = 'trigger';
    styleThemeTrigger(button, this);
    button.textContent ||= this.hasAttribute('repair')
      ? 'Review customized cart'
      : (this.getAttribute('trigger-label') ?? 'Customize this product');
    if (!button.parentNode) this.append(button);
    const slot = document.createElement('slot');
    slot.name = 'trigger';
    this.root.replaceChildren(slot);
    button.addEventListener('click', this.triggerClick);
  }
  private async mount() {
    if (this.liveFrame) {
      if (this.liveFrame.open()) return;
      this.liveFrame.destroy();
      this.liveFrame = undefined;
    }
    if (this.mounting) return;
    const generation = this.generation;
    const productId = this.getAttribute('product-id') ?? '';
    const proxyBase = this.getAttribute('proxy-base') ?? '/apps/insignia';
    const cartRoot = this.getAttribute('cart-root') ?? '/';
    if (!/^[1-9][0-9]{0,19}$/.test(productId)) {
      this.root.textContent = 'Customization unavailable';
      return;
    }
    this.mounting = true;
    try {
      const [{ createBuyerApi }, { mountLiveDesigner }] = await Promise.all([
        import('./buyer'),
        import('./designer/controller'),
      ]);
      const country = this.getAttribute('country') ?? '';
      const api = createBuyerApi({ proxyBase, productId, country, storage: sessionStorage });
      const source = await api.config();
      if (generation !== this.generation) return;
      {
        const controller = await mountLiveDesigner({
          source,
          proxyBase,
          cartRoot,
          country,
          marketId: this.getAttribute('market-id') ?? '',
          locale: this.getAttribute('language') || document.documentElement.lang || 'en',
          storeName:
            this.getAttribute('store-name') ?? source.title ?? source.selectedSetup?.product.title ?? 'Customization',
          storage: sessionStorage,
          repair: this.hasAttribute('repair'),
          isCurrent: () => generation === this.generation,
          onClose: () => {
            this.querySelector<HTMLButtonElement>('button[slot="trigger"]')?.focus();
          },
          onError: () => {
            const notice = this.root.querySelector('[role=alert]') ?? document.createElement('p');
            notice.setAttribute('role', 'alert');
            notice.textContent = 'Customization unavailable';
            this.root.append(notice);
          },
        });
        if (generation !== this.generation) {
          controller.destroy();
          return;
        }
        this.liveFrame = controller;
        return;
      }
    } catch {
      if (generation !== this.generation) return;
      const { mountUnavailableDesigner } = await import('./designer/unavailable');
      const unavailable = await mountUnavailableDesigner({
        locale: this.getAttribute('language') || document.documentElement.lang || 'en',
        cartRoot,
        storage: sessionStorage,
        onClose: () => this.querySelector<HTMLButtonElement>('button[slot="trigger"]')?.focus(),
        retry: async () => {
          this.liveFrame?.destroy();
          this.liveFrame = undefined;
          this.mounting = false;
          await this.mount();
        },
      });
      if (generation !== this.generation) {
        unavailable.destroy();
        return;
      }
      this.liveFrame = unavailable;
      return;
    } finally {
      this.mounting = false;
    }
  }
  disconnectedCallback() {
    this.generation++;
    this.querySelector<HTMLButtonElement>('button[slot="trigger"]')?.removeEventListener('click', this.triggerClick);
    this.liveFrame?.destroy();
    this.liveFrame = undefined;
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

export class InsigniaThemeIntegration extends HTMLElement {
  private dispose?: () => void;
  connectedCallback() {
    this.dispose?.();
    this.dispose = connectThemeIntegration(this);
  }
  disconnectedCallback() {
    this.dispose?.();
    this.dispose = undefined;
  }
}
if (!customElements.get('insignia-theme-integration'))
  customElements.define('insignia-theme-integration', InsigniaThemeIntegration);
