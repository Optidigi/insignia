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
    if (this.preparation?.context === context && this.preparation.expiresAt > Date.now()) return;
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
      this.preparation?.context === this.context() && this.preparation.expiresAt > Date.now()
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
    const stopBusy = () => {
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
      this.clearPreparation();
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
