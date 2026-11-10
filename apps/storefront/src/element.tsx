import { render } from 'preact';
import type { BuyerConfig } from './buyer';
import type { mountLiveDesigner } from './designer/controller';

type LiveDesigner = Awaited<ReturnType<typeof mountLiveDesigner>>;

import { createDesignerModal } from './designer/modal';
import { connectThemeIntegration, styleThemeTrigger } from './theme-integration';

/** Ordinary product presentation is prepared on idle/intent; cart custody remains click-only. */
export class InsigniaBuyer extends HTMLElement {
  private static preparationOwner?: InsigniaBuyer;
  private readonly root = this.attachShadow({ mode: 'open' });
  private generation = 0;
  private liveFrame?: { open(): boolean; destroy(): void };
  private mounting = false;
  private cancelOpening?: () => void;
  private stopBusy?: () => void;
  private readonly triggerClick = () => void this.mount();
  private readonly triggerIntent = () => this.prewarm(true);
  private cancelIdle?: () => void;
  private preparation?: {
    context: string;
    controller: AbortController;
    source: Promise<BuyerConfig>;
    expiresAt: number;
    warm?: LiveDesigner;
    expiryTimer?: ReturnType<typeof setTimeout>;
    removeAssets?: () => void;
  };
  static get observedAttributes() {
    return ['product-id', 'proxy-base', 'country', 'market-id', 'language', 'cart-root', 'store-name', 'repair'];
  }
  private context() {
    return JSON.stringify([
      ...InsigniaBuyer.observedAttributes.map((name) => this.getAttribute(name)),
      document.documentElement.lang,
    ]);
  }
  private clearPreparation() {
    if (InsigniaBuyer.preparationOwner === this) InsigniaBuyer.preparationOwner = undefined;
    this.preparation?.controller.abort();
    this.preparation?.warm?.destroy();
    clearTimeout(this.preparation?.expiryTimer);
    this.preparation?.removeAssets?.();
    this.preparation = undefined;
  }
  private prewarm(intent = false) {
    if (!this.isConnected || this.hasAttribute('repair') || this.mounting || this.liveFrame) return;
    if (!intent) {
      const button = this.querySelector<HTMLButtonElement>('button[slot="trigger"]');
      const rect = button?.getBoundingClientRect();
      if (
        !button ||
        !rect ||
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.bottom <= 0 ||
        rect.right <= 0 ||
        rect.top >= window.innerHeight ||
        rect.left >= window.innerWidth ||
        getComputedStyle(button).visibility !== 'visible' ||
        document.querySelector('dialog[open]')
      )
        return;
    }
    const owner = InsigniaBuyer.preparationOwner;
    if (owner && owner !== this) {
      if (!intent || owner.mounting || owner.liveFrame) return;
      owner.clearPreparation();
    }
    const context = this.context();
    if (
      this.preparation?.context === context &&
      !this.preparation.controller.signal.aborted &&
      this.preparation.expiresAt > Date.now()
    )
      return;
    this.clearPreparation();
    const productId = this.getAttribute('product-id') ?? '';
    if (!/^[1-9][0-9]{0,19}$/.test(productId)) return;
    const controller = new AbortController();
    InsigniaBuyer.preparationOwner = this;
    const preparation = {
      context,
      controller,
      expiresAt: Date.now() + 60000,
      source: import('./buyer').then(async ({ createBuyerApi }) => {
        const source = await createBuyerApi({
          proxyBase: this.getAttribute('proxy-base') ?? '/apps/insignia',
          productId,
          country: this.getAttribute('country') ?? '',
        }).config(controller.signal);
        // Presentation must not outlive a signed preview capability, even inside
        // the short advisory cache. Quotes/acceptance never use this as authority.
        for (const raw of Object.values(source.imageUrls)) {
          const url = new URL(raw);
          const date = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(url.searchParams.get('X-Amz-Date') ?? '');
          const seconds = Number(url.searchParams.get('X-Amz-Expires'));
          if (date && Number.isFinite(seconds) && seconds > 0) {
            const instant = Date.UTC(
              Number(date[1]),
              Number(date[2]) - 1,
              Number(date[3]),
              Number(date[4]),
              Number(date[5]),
              Number(date[6]),
            );
            preparation.expiresAt = Math.min(preparation.expiresAt, instant + seconds * 1000);
          }
        }
        if (
          controller.signal.aborted ||
          this.preparation !== preparation ||
          this.mounting ||
          preparation.expiresAt <= Date.now()
        )
          return source;
        preparation.expiryTimer = setTimeout(
          () => {
            if (this.preparation === preparation) this.clearPreparation();
          },
          Math.max(0, preparation.expiresAt - Date.now()),
        );
        const warm = await this.createController(source, true);
        if (controller.signal.aborted || this.preparation !== preparation || preparation.context !== this.context())
          warm.destroy();
        else preparation.warm = warm;
        return source;
      }),
      warm: undefined as LiveDesigner | undefined,
      expiryTimer: undefined as ReturnType<typeof setTimeout> | undefined,
      removeAssets: undefined as (() => void) | undefined,
    };
    this.preparation = preparation;
    void preparation.source.catch(() => {
      if (this.preparation === preparation) this.clearPreparation();
    });
    void import('./designer/frame-host')
      .then(({ prewarmDesignerAssets }) => {
        if (controller.signal.aborted) return;
        preparation.removeAssets = prewarmDesignerAssets();
      })
      .catch(() => {});
    void import('./designer/controller').catch(() => {});
  }
  attributeChangedCallback(_name: string, previous: string | null, next: string | null) {
    if (previous === next || !this.isConnected) return;
    this.generation++;
    this.cancelOpening?.();
    this.cancelOpening = undefined;
    this.mounting = false;
    this.clearPreparation();
    this.liveFrame?.destroy();
    this.liveFrame = undefined;
  }
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
    button.addEventListener('pointerenter', this.triggerIntent);
    button.addEventListener('focus', this.triggerIntent);
    if ('requestIdleCallback' in window) {
      const idle = window.requestIdleCallback(() => this.prewarm(), { timeout: 1500 });
      this.cancelIdle = () => window.cancelIdleCallback(idle);
    } else {
      const idle = setTimeout(() => this.prewarm(), 150);
      this.cancelIdle = () => clearTimeout(idle);
    }
  }
  private async createController(
    source: BuyerConfig,
    initiallyHidden = false,
    modal?: ReturnType<typeof createDesignerModal>,
  ): Promise<LiveDesigner> {
    const generation = this.generation;
    const { mountLiveDesigner } = await import('./designer/controller');
    return mountLiveDesigner({
      initiallyHidden,
      modal,
      source,
      proxyBase: this.getAttribute('proxy-base') ?? '/apps/insignia',
      cartRoot: this.getAttribute('cart-root') ?? '/',
      country: this.getAttribute('country') ?? '',
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
  }
  private async mount() {
    this.cancelIdle?.();
    this.cancelIdle = undefined;
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
    const prepared =
      this.preparation?.context === this.context() &&
      !this.preparation.controller.signal.aborted &&
      this.preparation.expiresAt > Date.now()
        ? this.preparation
        : undefined;
    if (!prepared) this.clearPreparation();
    if (prepared?.warm?.ready) {
      const warm = prepared.warm;
      prepared.warm = undefined;
      this.clearPreparation();
      this.liveFrame = warm;
      if (warm.open()) return;
      warm.destroy();
      this.liveFrame = undefined;
    }
    this.mounting = true;
    const trigger = this.querySelector<HTMLButtonElement>('button[slot="trigger"]');
    const spinner = document.createElement('span');
    spinner.setAttribute('aria-hidden', 'true');
    spinner.setAttribute('data-insignia-loading', '');
    spinner.style.cssText =
      'display:inline-block;width:1em;height:1em;margin-inline-start:.5em;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:middle;';
    const icon = trigger?.querySelector<HTMLElement>('[data-insignia-theme-icon]');
    const iconDisplay = icon?.style.getPropertyValue('display') ?? '';
    const iconPriority = icon?.style.getPropertyPriority('display') ?? '';
    const animation = !matchMedia('(prefers-reduced-motion: reduce)').matches
      ? spinner.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], {
          duration: 700,
          iterations: Infinity,
        })
      : undefined;
    trigger?.setAttribute('aria-busy', 'true');
    if (icon) {
      spinner.style.marginInlineStart = '0';
      icon.style.setProperty('display', 'none', 'important');
      icon.before(spinner);
    } else trigger?.append(spinner);
    let busyStopped = false;
    const stopBusy = () => {
      if (busyStopped) return;
      busyStopped = true;
      animation?.cancel();
      spinner.remove();
      if (icon) {
        if (iconDisplay) icon.style.setProperty('display', iconDisplay, iconPriority);
        else icon.style.removeProperty('display');
      }
      trigger?.removeAttribute('aria-busy');
    };
    this.stopBusy = stopBusy;
    const opening = new AbortController();
    opening.signal.addEventListener('abort', () => prepared?.controller.abort(), { once: true });
    const pending = createDesignerModal({
      locale: this.getAttribute('language') || document.documentElement.lang,
      onRetry: () => {
        opening.abort();
        this.generation++;
        // Once the frame adopts this shell, retire its listeners and timers too.
        this.liveFrame?.destroy();
        this.liveFrame = undefined;
        pending.destroy();
        this.mounting = false;
        void this.mount();
      },
      onCancel: () => {
        opening.abort();
        this.generation++;
        this.cancelOpening = undefined;
        pending.destroy();
        this.stopBusy?.();
        this.querySelector<HTMLButtonElement>('button[slot="trigger"]')?.focus();
        this.mounting = false;
      },
    });
    pending.onSettled(stopBusy);
    let adopted = false;
    const loadingTimeout = setTimeout(() => pending.failed(), 10000);
    this.cancelOpening = () => {
      clearTimeout(loadingTimeout);
      opening.abort();
      pending.destroy();
    };
    try {
      const { createBuyerApi } = await import('./buyer');
      const country = this.getAttribute('country') ?? '';
      const api = createBuyerApi({ proxyBase, productId, country, storage: sessionStorage });
      const candidate = prepared ? await prepared.source : undefined;
      const source =
        candidate && prepared && prepared.expiresAt > Date.now() ? candidate : await api.config(opening.signal);
      if (generation !== this.generation) return;
      {
        let controller = prepared?.warm;
        if (prepared) prepared.warm = undefined;
        if (controller) {
          controller.destroy();
          controller = undefined;
        }
        if (!controller) {
          controller = await this.createController(source, false, pending);
          adopted = true;
        }
        if (generation !== this.generation) {
          controller.destroy();
          return;
        }
        this.liveFrame = controller;
        return;
      }
    } catch {
      if (opening.signal.aborted || generation !== this.generation) return;
      const { mountUnavailableDesigner } = await import('./designer/unavailable');
      const unavailable = await mountUnavailableDesigner({
        modal: pending,
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
      adopted = true;
      this.liveFrame = unavailable;
      return;
    } finally {
      if (this.preparation === prepared) this.clearPreparation();
      clearTimeout(loadingTimeout);
      if (!adopted) {
        pending.destroy();
        stopBusy();
      }
      if (generation === this.generation) {
        this.mounting = false;
        this.cancelOpening = undefined;
      }
    }
  }
  disconnectedCallback() {
    this.generation++;
    this.cancelIdle?.();
    this.cancelIdle = undefined;
    this.clearPreparation();
    this.cancelOpening?.();
    this.cancelOpening = undefined;
    this.mounting = false;
    this.stopBusy?.();
    const trigger = this.querySelector<HTMLButtonElement>('button[slot="trigger"]');
    trigger?.removeEventListener('click', this.triggerClick);
    trigger?.removeEventListener('pointerenter', this.triggerIntent);
    trigger?.removeEventListener('focus', this.triggerIntent);
    this.liveFrame?.destroy();
    this.liveFrame = undefined;
    render(null, this.root);
  }
}
if (!customElements.get('insignia-buyer')) customElements.define('insignia-buyer', InsigniaBuyer);

type CartJsLine = {
  product_id?: number;
  quantity?: number;
  original_price?: number;
  properties?: Record<string, unknown>;
};
const CART_MUTATION = /\/cart\/(?:add|change|update|clear)(?:\.js)?$/;
const isCustomized = (line: CartJsLine) =>
  !!line.properties &&
  (Object.hasOwn(line.properties, '_insignia_quote_v2') || Object.hasOwn(line.properties, '_insignia_member_v2'));

/** Signed quantity/unit for presentation only. Layout owner: packages/cart-authorization/src/whole-quote.ts
 * (u16 index, u64 variant, u32 quantity, u64 unit minor). Shopify Functions remain the price/checkout authority. */
export function signedMember(carrier: unknown): { quantity: number; unitMinor: bigint } | undefined {
  if (typeof carrier !== 'string' || !/^[A-Za-z0-9_-]{30}$/.test(carrier)) return;
  try {
    const binary = atob(carrier.replace(/-/g, '+').replace(/_/g, '/'));
    if (binary.length !== 22) return;
    const view = new DataView(Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer);
    return { quantity: view.getUint32(10), unitMinor: view.getBigUint64(14) };
  } catch {
    return;
  }
}

/** A designed line no longer shows the quantity and customization price it was accepted with. */
export function customizedLineNeedsReview(line: CartJsLine): boolean {
  if (!isCustomized(line)) return false;
  const member = signedMember(line.properties?._insignia_member_v2);
  return (
    !member ||
    member.quantity !== line.quantity ||
    typeof line.original_price !== 'number' ||
    BigInt(line.original_price) !== member.unitMinor
  );
}

export class InsigniaCartRepair extends HTMLElement {
  private abort?: AbortController;
  private observer?: PerformanceObserver;
  private readonly refresh = () => this.load();
  connectedCallback() {
    window.addEventListener('insignia-cart-updated', this.refresh);
    // Native theme quantity/remove controls change the cart without an Insignia event.
    if (typeof PerformanceObserver === 'function') {
      const observer = new PerformanceObserver((list) => {
        if (list.getEntries().some((entry) => CART_MUTATION.test(new URL(entry.name, location.href).pathname)))
          this.load();
      });
      try {
        observer.observe({ type: 'resource' });
        this.observer = observer;
      } catch {
        /* Resource timing unavailable: Insignia events still refresh. */
      }
    }
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
        const cart = (await response.json()) as { items?: CartJsLine[] };
        if (controller.signal.aborted || this.abort !== controller) return;
        const customized = (cart.items ?? []).filter(isCustomized);
        const changed = customized.find(customizedLineNeedsReview);
        const line = changed ?? customized[0];
        if (!line) this.replaceChildren();
        else this.render(String(line.product_id), !!changed);
      })
      .catch(() => {});
  }
  private render(productId: string, needsReview: boolean) {
    let buyer = this.querySelector('insignia-buyer');
    if (buyer?.getAttribute('product-id') !== productId) {
      // Light DOM keeps the theme's own button styling on the trigger.
      buyer = document.createElement('insignia-buyer');
      for (const attribute of ['proxy-base', 'cart-root', 'country', 'market-id']) {
        const value = this.getAttribute(attribute);
        if (value) buyer.setAttribute(attribute, value);
      }
      const label = this.getAttribute('review-label');
      if (label) {
        const button = document.createElement('button');
        button.slot = 'trigger';
        button.textContent = label;
        buyer.append(button);
      }
      buyer.setAttribute('product-id', productId);
      buyer.setAttribute('repair', '');
    }
    let notice = this.querySelector<HTMLElement>(':scope > .insignia-cart-review');
    if (!notice) {
      notice = document.createElement('div');
      notice.className = 'insignia-cart-review';
      notice.setAttribute('role', 'status');
      notice.append(document.createElement('p'));
      this.replaceChildren(notice);
    }
    const text = notice.querySelector('p');
    if (text) {
      text.textContent = needsReview
        ? (this.getAttribute('review-message') ??
          'Your customized items changed and are shown without customization prices. Review them before checkout.')
        : '';
      text.hidden = !needsReview;
      text.style.margin = '0 0 0.75rem';
    }
    notice.toggleAttribute('data-needs-review', needsReview);
    // Only a changed cart needs a prominent prompt; otherwise keep the existing inline edit entry.
    Object.assign(
      notice.style,
      needsReview
        ? {
            position: 'fixed',
            insetInline: '1rem',
            bottom: '1rem',
            zIndex: '20',
            maxWidth: '32rem',
            marginInline: 'auto',
            padding: '1rem',
            background: 'Canvas',
            color: 'CanvasText',
            border: '1px solid currentColor',
            borderRadius: '0.5rem',
            boxShadow: '0 0.5rem 1.5rem rgb(0 0 0 / 0.2)',
          }
        : {
            position: '',
            insetInline: '',
            bottom: '',
            zIndex: '',
            maxWidth: '',
            marginInline: '',
            padding: '',
            background: '',
            color: '',
            border: '',
            borderRadius: '',
            boxShadow: '',
          },
    );
    if (buyer.parentElement !== notice) notice.append(buyer);
  }
  disconnectedCallback() {
    window.removeEventListener('insignia-cart-updated', this.refresh);
    this.observer?.disconnect();
    this.abort?.abort();
    this.replaceChildren();
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
