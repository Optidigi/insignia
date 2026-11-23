import type { BuyerConfig } from './buyer';
import { adoptTabSession, readBuyerSession, sharedBuyerStorage } from './buyer-session';
import type { mountLiveDesigner } from './designer/controller';

type LiveDesigner = Awaited<ReturnType<typeof mountLiveDesigner>>;

import type { createDesignerModal } from './designer/modal';
import { connectThemeIntegration, styleThemeTrigger } from './theme-integration';

// The modal brings Preact, localization and theme preference; product pages load it
// only on idle preparation, trigger intent or click, never with this entry.
const loadDesignerModal = () => import('./designer/modal');

/** Ordinary product presentation is prepared on idle/intent; cart custody remains click-only. */
export class InsigniaBuyer extends HTMLElement {
  private static preparationOwner?: InsigniaBuyer;
  private readonly root = this.attachShadow({ mode: 'open' });
  private generation = 0;
  private liveFrame?: { open(): boolean | Promise<boolean>; destroy(): void };
  private mounting = false;
  private cancelOpening?: () => void;
  private stopBusy?: () => void;
  private readonly triggerClick = () => void this.mount();
  private readonly triggerIntent = () => {
    void loadDesignerModal().catch(() => {});
    this.prewarm(true);
  };
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
      // The cart page is not a product page: a product control there (e.g. a recommendation
      // quick-add) loads its configuration on hover/focus or click, not on every cart view.
      const cartRoot = this.getAttribute('cart-root') ?? '/';
      if (location.pathname.replace(/\/+$/, '') === `${cartRoot}cart`) return;
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
          marketId: this.getAttribute('market-id') ?? undefined,
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
      productPageVariant: () => this.productPageVariant(),
      isCurrent: () => generation === this.generation,
      onClose: () => {
        this.querySelector<HTMLButtonElement>('button[slot="trigger"]')?.focus();
      },
      onError: () => this.unavailableNotice(),
    });
  }
  private unavailableNotice() {
    const notice = this.root.querySelector('[role=alert]') ?? document.createElement('p');
    notice.setAttribute('role', 'alert');
    notice.textContent = 'Customization unavailable';
    this.root.append(notice);
  }
  /** The trigger's busy state while the Designer opens. */
  private busy() {
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
    return stopBusy;
  }
  /**
   * The variant selected in this product's form, read when the Designer opens. Only a starting hint for a fresh
   * design (#499): the Designer maps it to a colour it offers, and quotes still decide everything.
   */
  private productPageVariant(): string | undefined {
    const productId = this.getAttribute('product-id');
    const forms = [
      ...(this.closest('.shopify-section, section, product-info, main') ?? document).querySelectorAll<HTMLFormElement>(
        'form[action*="/cart/add"]',
      ),
    ];
    for (const form of forms) {
      const product = form.querySelector<HTMLInputElement>('input[name="product-id"]')?.value;
      if (product && productId && product !== productId) continue;
      const value = form.querySelector<HTMLInputElement | HTMLSelectElement>('[name="id"]')?.value ?? '';
      if (/^[1-9][0-9]{0,19}$/.test(value)) return value;
    }
    const fromUrl = new URLSearchParams(location.search).get('variant') ?? '';
    return /^[1-9][0-9]{0,19}$/.test(fromUrl) ? fromUrl : undefined;
  }
  /** Shows an existing Designer again; true when nothing else is to be opened. */
  private async reopen(frame: NonNullable<InsigniaBuyer['liveFrame']>, generation: number) {
    this.liveFrame = frame;
    // A cart design re-reads its cart line before it is shown again (#397).
    this.mounting = true;
    const stopBusy = this.busy();
    let opened = false;
    try {
      opened = await frame.open();
    } finally {
      stopBusy();
      if (generation === this.generation) this.mounting = false;
    }
    if (opened || generation !== this.generation || this.liveFrame !== frame) return true;
    frame.destroy();
    this.liveFrame = undefined;
    return false;
  }
  private async mount() {
    this.cancelIdle?.();
    this.cancelIdle = undefined;
    if (this.mounting) return;
    const generation = this.generation;
    if (this.liveFrame && (await this.reopen(this.liveFrame, generation))) return;
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
      if (await this.reopen(warm, generation)) return;
    }
    this.mounting = true;
    const stopBusy = this.busy();
    let modal: Awaited<ReturnType<typeof loadDesignerModal>>;
    try {
      modal = await loadDesignerModal();
    } catch {
      stopBusy();
      if (generation !== this.generation) return;
      this.mounting = false;
      this.unavailableNotice();
      return;
    }
    if (generation !== this.generation) {
      stopBusy();
      return;
    }
    const opening = new AbortController();
    opening.signal.addEventListener('abort', () => prepared?.controller.abort(), { once: true });
    const pending = modal.createDesignerModal({
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
      const api = createBuyerApi({
        proxyBase,
        productId,
        country,
        marketId: this.hasAttribute('repair') ? undefined : (this.getAttribute('market-id') ?? undefined),
      });
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
    } catch (error) {
      if (opening.signal.aborted || generation !== this.generation) return;
      if ((error as { code?: unknown } | null)?.code === 'UNSUPPORTED_MARKET') {
        pending.failed('unsupported-market');
        // Keep ownership with the element until the shopper closes the message.
        this.liveFrame = { open: pending.show, destroy: pending.destroy };
        pending.setCancelHandler(() => {
          this.liveFrame = undefined;
          pending.destroy();
        });
        adopted = true;
        return;
      }
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
    this.root.replaceChildren();
  }
}
if (!customElements.get('insignia-buyer')) customElements.define('insignia-buyer', InsigniaBuyer);

type CartJsLine = {
  product_id?: number;
  variant_id?: number;
  quantity?: number;
  original_price?: number;
  properties?: Record<string, unknown>;
};
const CART_MUTATION = /\/cart\/(?:add|change|update|clear)(?:\.js)?$/;
const LINE = '_insignia_line_v3';
const LEGACY = ['_insignia_quote_v2', '_insignia_member_v2'];
const isCustomized = (line: CartJsLine) =>
  !!line.properties && [LINE, ...LEGACY].some((key) => Object.hasOwn(line.properties ?? {}, key));

/** A per-line v3 carrier decoded for presentation only. Layout owner: packages/cart-authorization/src/line-v3.ts
 * (113-byte header, 64-byte signature, 17-byte record: u8 index, u64 variant, u64 unit minor; then the proof).
 * Nothing is verified here: Shopify Functions remain the price/checkout authority. */
type SignedLine = {
  prefix: string;
  index: number;
  unitMinor: bigint;
  currency: string;
  country: string;
  marketId: string;
  validThroughDay: number;
};
export function signedLine(carrier: unknown): SignedLine | undefined {
  if (typeof carrier !== 'string' || !/^[A-Za-z0-9_-]{259,472}$/.test(carrier)) return;
  try {
    const bytes = Uint8Array.from(atob(carrier.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
    const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
    const count = bytes[60] ?? 0;
    const depth = bytes[61] ?? 0;
    if (ascii(0, 4) !== 'ISG3' || bytes[4] !== 3 || count < 1 || count > 32 || depth > 5) return;
    if (bytes.length !== 194 + 32 * depth || (bytes[177] ?? 255) >= count) return;
    const view = new DataView(bytes.buffer);
    return {
      prefix: carrier.slice(0, 236),
      index: bytes[177] ?? 0,
      unitMinor: view.getBigUint64(186),
      currency: ascii(62, 65),
      country: ascii(66, 68),
      marketId: view.getBigUint64(68).toString(),
      validThroughDay: view.getUint32(76),
    };
  } catch {
    return;
  }
}

export type CartReviewReason = 'changed' | 'context' | 'expired';
/**
 * Why designed lines no longer carry their signed prices, for presentation only. Native quantity changes and
 * removed lines are never a reason: each v3 line carries its own authorization and quantity is not signed.
 * - `context`: cart currency or the storefront country/Market differs from the signed context;
 * - `expired`: the shared valid-through day may have passed. The day is shop-local and the browser cannot know
 *   the shop zone, so this only excludes sets that are certainly still valid (any zone is within one day of
 *   UTC). The server decides renewal;
 * - `changed`: anything else (an undecodable or legacy v2 line, mixed sets, a different observed unit price).
 */
export function cartReviewReason(
  lines: CartJsLine[],
  context: { currency?: string; country?: string; marketId?: string },
  utcDay = Math.floor(Date.now() / 86400000),
): CartReviewReason | undefined {
  const signed = lines.map((line) => signedLine(line.properties?.[LINE]));
  const prefix = signed[0]?.prefix;
  // Checkout accepts one signed set per cart, so lines from different sets need review too.
  const oneSet = signed.every((line) => line?.prefix === prefix);
  if (oneSet && !lines.some(customizedLineNeedsReview)) return;
  const market = context.marketId?.replace(/^gid:\/\/shopify\/Market\//, '');
  if (
    signed.some(
      (header) =>
        header &&
        ((!!context.currency && header.currency !== context.currency) ||
          (!!context.country && header.country !== context.country) ||
          (!!market && header.marketId !== market)),
    )
  )
    return 'context';
  const day = signed[0]?.validThroughDay;
  return oneSet && day !== undefined && day <= utcDay ? 'expired' : 'changed';
}

/** Whether this browser still holds a buyer session that may own the cart's accepted sets. */
function hasBuyerSession(proxyBase: string) {
  const storage = sharedBuyerStorage();
  return !!(readBuyerSession(storage, proxyBase) ?? adoptTabSession(storage, proxyBase));
}

/** A designed line no longer shows its signed customization price (quantity is never compared). */
export function customizedLineNeedsReview(line: CartJsLine): boolean {
  if (!isCustomized(line)) return false;
  const signed = signedLine(line.properties?.[LINE]);
  return !signed || typeof line.original_price !== 'number' || BigInt(line.original_price) !== signed.unitMinor;
}

/**
 * Rendered and not hidden. A closed theme cart drawer keeps its checkout button laid out but `visibility: hidden`
 * (Dawn), and it often comes first in the document, so layout alone would pick the drawer on the cart page.
 */
function isShown(element: HTMLElement): boolean {
  if (element.getClientRects().length === 0) return false;
  return typeof element.checkVisibility === 'function'
    ? element.checkVisibility({ visibilityProperty: true, opacityProperty: true })
    : getComputedStyle(element).visibility !== 'hidden';
}

/** Theme containers that list cart lines: cart forms and Dawn/Horizon-style cart page and drawer elements. */
const CART_LINES = 'form[action$="/cart"], cart-items, cart-drawer-items, cart-items-component, [data-cart-items]';
const LINE_MARKER = 'insignia-cart-line-marker';

/**
 * Marks each customized line in the theme's cart markup, right after its product title link. Only cart order and
 * variant are used: within one cart container the titled links to a variant map to that variant's cart lines in
 * order. When the theme shows a different number of rows, a variant is marked only if all its lines are customized.
 * Presentation only: no signed content is read or shown, and lines the theme does not link are left unmarked.
 */
export function markCustomizedLines(
  items: CartJsLine[],
  labels: { customized: string; review: string },
  root: Document = document,
) {
  const wanted = new Map<Element, string>();
  if (items.some(isCustomized)) {
    const containers = new Set<Element>();
    for (const link of root.querySelectorAll('a[href*="variant="]')) {
      const container = link.closest(CART_LINES);
      if (container && !link.closest('insignia-cart-repair, .insignia-cart-review')) containers.add(container);
    }
    for (const container of containers) {
      const links = new Map<string, HTMLAnchorElement[]>();
      for (const link of container.querySelectorAll<HTMLAnchorElement>('a[href*="variant="]')) {
        // Image links repeat the title link without text; nested containers are handled on their own.
        if (link.closest(CART_LINES) !== container || !link.textContent?.trim()) continue;
        const variant = new URL(link.href, location.href).searchParams.get('variant');
        if (variant) links.set(variant, [...(links.get(variant) ?? []), link]);
      }
      for (const [variant, anchors] of links) {
        const lines = items.filter((line) => String(line.variant_id) === variant);
        if (!lines.some(isCustomized)) continue;
        const allCustomized = lines.every(isCustomized);
        anchors.forEach((anchor, index) => {
          const line =
            anchors.length === lines.length
              ? lines[index]
              : allCustomized
                ? (lines.find(customizedLineNeedsReview) ?? lines[0])
                : undefined;
          if (line && isCustomized(line))
            wanted.set(anchor, customizedLineNeedsReview(line) ? labels.review : labels.customized);
        });
      }
    }
  }
  for (const marker of root.querySelectorAll(`.${LINE_MARKER}`)) {
    const anchor = marker.previousElementSibling;
    if (!anchor || wanted.get(anchor) !== marker.textContent) marker.remove();
  }
  for (const [anchor, text] of wanted) {
    if (anchor.nextElementSibling?.classList.contains(LINE_MARKER)) continue;
    const marker = root.createElement('span');
    marker.className = LINE_MARKER;
    marker.textContent = text;
    Object.assign(marker.style, { display: 'block', fontSize: '0.875em', marginBlockStart: '0.25rem' });
    anchor.after(marker);
  }
}

export class InsigniaCartRepair extends HTMLElement {
  private abort?: AbortController;
  private observer?: PerformanceObserver;
  /** Themes re-render cart markup after their own fetches; markers and the moved notice are restored afterwards. */
  private mutations?: MutationObserver;
  private frame = 0;
  private lines: CartJsLine[] = [];
  /** The review entry. On the cart page it sits above the theme's checkout controls, outside this element. */
  private notice?: HTMLElement;
  private renewing = false;
  private renewFailed = false;
  /** The stored session's cart-state called the cart's set renewable at the last load. */
  private renewableNow = false;
  private readonly refresh = () => this.load();
  connectedCallback() {
    window.addEventListener('insignia-cart-updated', this.refresh);
    if (typeof MutationObserver === 'function') {
      this.mutations = new MutationObserver(() => {
        if (this.frame || !this.lines.some(isCustomized)) return;
        this.frame = requestAnimationFrame(() => {
          this.frame = 0;
          this.restore();
        });
      });
      this.mutations.observe(document.body, { childList: true, subtree: true });
    }
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
    // Renewal's own verified cart writes pass through transient states; it reloads when settled.
    if (this.renewing) return;
    this.abort?.abort();
    const controller = new AbortController();
    this.abort = controller;
    const cartRoot = this.getAttribute('cart-root') ?? '/';
    if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(cartRoot)) return;
    void fetch(`${cartRoot}cart.js`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const cart = (await response.json()) as {
          items?: CartJsLine[];
          attributes?: Record<string, unknown>;
          currency?: string;
        };
        if (controller.signal.aborted || this.abort !== controller) return;
        this.lines = cart.items ?? [];
        this.markLines();
        const customized = this.lines.filter(isCustomized);
        const reason = cartReviewReason(customized, {
          currency: typeof cart.currency === 'string' ? cart.currency : undefined,
          country: this.getAttribute('country') ?? undefined,
          marketId: this.getAttribute('market-id') ?? undefined,
        });
        if (!reason) this.renewFailed = false;
        const line = customized.find(customizedLineNeedsReview) ?? customized[0];
        if (line) {
          const proxyBase = this.getAttribute('proxy-base') ?? '/apps/insignia';
          // Renew is offered only when the stored session can renew this set; asking never mints a session.
          let renewable = false;
          if (reason === 'expired' && !this.renewFailed && hasBuyerSession(proxyBase))
            renewable = await import('./renewal')
              .then(({ cartRenewable }) =>
                cartRenewable({
                  proxyBase,
                  cartRoot,
                  productId: String(line.product_id),
                  country: this.getAttribute('country') ?? '',
                  marketId: this.getAttribute('market-id') ?? '',
                  storage: sessionStorage,
                }),
              )
              .catch(() => false);
          if (controller.signal.aborted || this.abort !== controller) return;
          this.renewableNow = renewable;
          this.render(String(line.product_id), reason);
          return;
        }
        this.clearNotice();
        if (cart.attributes?._insignia_quote_v2) this.clearStaleQuote(cartRoot, controller.signal);
      })
      .catch(() => {});
  }
  private markLines() {
    markCustomizedLines(this.lines, {
      customized: this.getAttribute('line-label') ?? 'Customized',
      review: this.getAttribute('line-review-label') ?? 'Customized · needs review',
    });
  }
  /** After a theme re-render: re-mark lines and put a removed review entry back. */
  private restore() {
    if (!this.isConnected) return;
    this.markLines();
    if (this.notice && !this.notice.isConnected) this.placeNotice(this.notice);
  }
  /**
   * On the cart page the review entry goes right above the visible checkout controls, so it is seen next to the
   * cart lines and comes before checkout in keyboard order. Elsewhere, or when the theme has no recognizable
   * checkout button, it stays at this embed. It is placed once (or again after a theme re-render removed it):
   * moving it would reconnect the Designer element inside.
   */
  private placeNotice(notice: HTMLElement) {
    const cartRoot = this.getAttribute('cart-root') ?? '/';
    const checkout =
      location.pathname.replace(/\/+$/, '') === `${cartRoot}cart`
        ? [...document.querySelectorAll<HTMLElement>('button[name="checkout"], input[name="checkout"]')].find(
            (button) => isShown(button) && !button.closest('insignia-cart-repair'),
          )
        : undefined;
    const group = checkout?.parentElement;
    const anchor = group && !['FORM', 'BODY'].includes(group.tagName) ? group : checkout;
    if (anchor) anchor.before(notice);
    else this.replaceChildren(notice);
  }
  private clearNotice() {
    this.notice?.remove();
    this.notice = undefined;
    this.replaceChildren();
  }
  /**
   * Harmless cleanup of a leftover historical v2 cart-level quote attribute once no designed line remains.
   * v3 writes no cart attribute (each line carries its own authorization) and checkout ignores this one;
   * it is cleared only so stale protocol data does not linger. An unresolved Insignia operation in this tab
   * keeps the cart untouched for its own recovery.
   */
  private clearStaleQuote(cartRoot: string, signal: AbortSignal) {
    try {
      // Same key as buyer.ts cartJournal.
      if (sessionStorage.getItem('insignia-cart-unresolved-v2') === '1') return;
    } catch {
      return;
    }
    void fetch(`${cartRoot}cart/update.js`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ attributes: { _insignia_quote_v2: '' } }),
      signal,
    }).catch(() => {});
  }
  private async renew(productId: string) {
    if (this.renewing) return;
    this.renewing = true;
    this.render(productId, 'expired');
    const cartRoot = this.getAttribute('cart-root') ?? '/';
    let renewed = false;
    try {
      const { renewCartPrices } = await import('./renewal');
      renewed = await renewCartPrices({
        proxyBase: this.getAttribute('proxy-base') ?? '/apps/insignia',
        cartRoot,
        productId,
        country: this.getAttribute('country') ?? '',
        marketId: this.getAttribute('market-id') ?? '',
        storage: sessionStorage,
      });
    } catch {
      /* Review required, entitlement denied or unavailable: the Designer repair remains. */
    } finally {
      this.renewing = false;
    }
    if (!this.isConnected) return;
    if (renewed) {
      // Like the Designer, show Shopify's own cart with the renewed prices applied.
      window.location.assign(`${cartRoot}cart`);
      return;
    }
    this.renewFailed = true;
    this.render(productId, 'expired');
    this.notice?.querySelector<HTMLButtonElement>('insignia-buyer button[slot="trigger"]')?.focus();
    this.load();
  }
  private render(productId: string, reason: CartReviewReason | undefined) {
    const needsReview = !!reason;
    const renewable = reason === 'expired' && !this.renewFailed && this.renewableNow;
    let notice = this.notice;
    let buyer = notice?.querySelector('insignia-buyer');
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
    if (!notice) {
      notice = document.createElement('div');
      notice.className = 'insignia-cart-review';
      notice.setAttribute('role', 'status');
      notice.append(document.createElement('p'));
      this.notice = notice;
    }
    if (!notice.isConnected) this.placeNotice(notice);
    const text = notice.querySelector('p');
    if (text) {
      text.textContent = !needsReview
        ? ''
        : reason === 'context'
          ? (this.getAttribute('context-message') ??
            'Prices changed because your country or currency changed. Review customized items to update them.')
          : renewable
            ? (this.getAttribute('expired-message') ??
              'Your customization prices expired and are not applied. Renew them before checkout.')
            : reason === 'expired' && this.renewFailed
              ? (this.getAttribute('renew-failed-message') ??
                'Prices could not be renewed. Review your customized items before checkout.')
              : (this.getAttribute('review-message') ??
                'Your customized items changed and are shown without customization prices. Review them before checkout.');
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
            marginBlockEnd: '',
          }
        : {
            marginBlockEnd: '1rem',
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
    let renew = notice.querySelector<HTMLButtonElement>(':scope > button.insignia-cart-renew');
    if (renewable && !renew) {
      renew = document.createElement('button');
      renew.type = 'button';
      renew.className = 'button insignia-cart-renew';
      renew.style.marginInlineEnd = '0.5rem';
      renew.textContent = this.getAttribute('renew-label') ?? 'Renew prices';
      notice.querySelector('p')?.after(renew);
    }
    if (renew) {
      // Cart custody stays click-only: renewal starts from this buyer gesture.
      renew.onclick = () => void this.renew(productId);
      renew.hidden = !renewable;
      renew.disabled = this.renewing;
      renew.toggleAttribute('aria-busy', this.renewing);
    }
    if (buyer.parentElement !== notice) notice.append(buyer);
  }
  disconnectedCallback() {
    window.removeEventListener('insignia-cart-updated', this.refresh);
    this.observer?.disconnect();
    this.mutations?.disconnect();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.abort?.abort();
    this.lines = [];
    this.markLines();
    this.clearNotice();
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
