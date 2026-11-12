import type { MerchantCustomerWordingView } from '@insignia/contracts';
import { createCustomerTranslator } from '@insignia/ui-localization/customer';
import type { ProductConfig } from '../../../../frontend/designer/src/config';
import {
  customerBrowserLanguages,
  resolveCustomerHostLocale,
} from '../../../../frontend/designer/src/customer-language-policy.ts';
import { readCustomerLanguagePreference } from '../../../../frontend/designer/src/customer-language-preference.ts';
import type { Artwork, Design, Print } from '../../../../frontend/designer/src/model';
import type { DesignerQuoteReview } from '../../../../frontend/designer/src/quote-review';
import {
  type CartReceipt,
  type CartRequest,
  type DesignerPorts,
  matchesCartReceipt,
  type UploadRequest,
} from '../../../../frontend/designer/src/runtime';
import { createDesignerModal } from './modal';
import type { RepairAction } from './repair';

const escapeAttribute = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
function designerAssets() {
  const base = new URL(import.meta.url);
  base.pathname = base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1);
  base.search = '';
  base.hash = '';
  return { entry: new URL('insignia-designer-frame.js', base), css: new URL('insignia-designer.css', base) };
}

/** Fetch immutable frame assets without executing a frame or touching theme focus/styles. */
export function prewarmDesignerAssets(): () => void {
  const assets = designerAssets();
  const links: HTMLLinkElement[] = [];
  for (const [rel, url] of [
    ['modulepreload', assets.entry],
    ['preload', assets.css],
  ] as const) {
    if (
      [...document.head.querySelectorAll<HTMLLinkElement>('link')].some(
        (link) => link.rel === rel && link.href === url.href,
      )
    )
      continue;
    const link = document.createElement('link');
    link.rel = rel;
    link.href = url.href;
    if (rel === 'preload') link.as = 'style';
    document.head.append(link);
    links.push(link);
  }
  return () => {
    for (const link of links) link.remove();
  };
}

/** Run the selected CSS and event handlers in their own document, never in the Shopify theme. */
export function createDesignerFrame(input: {
  modal?: ReturnType<typeof createDesignerModal>;
  config?: ProductConfig;
  initiallyHidden?: boolean;
  title?: string;
  wording?: MerchantCustomerWordingView;
  ports?: DesignerPorts;
  locale?: string;
  previewOnly?: boolean;
  requiresCartReview?: boolean;
  initialDesign?: Design;
  initialBaseline?: Design;
  initialPrints?: Print[];
  initialArtworks?: Artwork[];
  repair?: { canStart: boolean; canRemoveGroup: boolean; canRemoveAll?: boolean };
  onRepair?: (action: RepairAction) => Promise<DesignerQuoteReview | undefined>;
  onClose(): void;
  onPreviewFailure?(url: string): void;
  onInitializationRetry?(): Promise<void> | void;
  onAppliedClose?(): void;
  onSelectGroup?: (id: string) => void;
}) {
  const channel = crypto.randomUUID();
  const frame = document.createElement('iframe');
  frame.title = input.config?.productName ?? input.title ?? 'Customization';
  frame.name = channel;
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  frame.referrerPolicy = 'origin';
  frame.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:2147483000;background:transparent;';
  const { entry, css } = designerAssets();
  // Baseline document language (e.g. a repair-only frame); a mounted Designer then mirrors its active language.
  const language = createCustomerTranslator(
    readCustomerLanguagePreference() ?? resolveCustomerHostLocale(input.locale, customerBrowserLanguages()),
  );
  frame.srcdoc = `<!doctype html><html lang="${escapeAttribute(language.lang)}" dir="${escapeAttribute(language.dir)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="origin"><link rel="stylesheet" href="${escapeAttribute(css.href)}"></head><body><script type="module" src="${escapeAttribute(entry.href)}"></script></body></html>`;
  const controllers = new Map<string, AbortController>();
  let committing: AbortController | undefined;
  let pendingRepair:
    | {
        value: { canStart: boolean; canRemoveGroup: boolean; canRemoveAll?: boolean };
        request: Pick<CartRequest, 'requestId' | 'signal'> | undefined;
      }
    | undefined;
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let ready = false;
  let initialized = false;
  let initializedMessage = false;
  let documentLoaded = false;
  let failed = false;
  let destroyed = false;
  const cancel = () => {
    if (initialized) send('insignia:designer:request-close');
    else close();
  };
  const modal =
    input.modal ??
    createDesignerModal({
      initiallyHidden: input.initiallyHidden,
      wording: input.wording,
      locale: input.locale,
      title: frame.title,
      onCancel: cancel,
      ...(input.onInitializationRetry
        ? {
            onRetry: () => {
              destroy();
              void input.onInitializationRetry?.();
            },
          }
        : {}),
    });
  modal.setCancelHandler(cancel);
  modal.setTitle(frame.title);
  frame.style.visibility = 'hidden';
  modal.dialog.append(frame);
  const initializationTimer = setTimeout(() => {
    if (!initialized && !destroyed) {
      failed = true;
      modal.failed();
    }
  }, 10000);
  function finishInitialization() {
    if (!initializedMessage || !documentLoaded || initialized || failed || destroyed) return;
    const styles = frame.contentDocument?.querySelector<HTMLLinkElement>('link[rel="stylesheet"]');
    const root = frame.contentDocument?.documentElement;
    const styled = root && frame.contentWindow?.getComputedStyle(root).getPropertyValue('--primary').trim();
    if (!styles?.sheet || !styled) {
      failed = true;
      clearTimeout(initializationTimer);
      modal.failed();
      return;
    }
    initialized = true;
    clearTimeout(initializationTimer);
    modal.loaded();
    frame.style.visibility = 'visible';
    if (!frame.hidden && modal.dialog.open) frame.focus();
  }
  frame.addEventListener('load', () => {
    if (frame.contentDocument?.URL !== 'about:srcdoc') return;
    documentLoaded = true;
    finishInitialization();
  });
  let applied: CartRequest | undefined;
  let completion: CartReceipt | undefined;
  function send(type: string, data: Record<string, unknown> = {}) {
    frame.contentWindow?.postMessage({ type, channel, ...data }, window.location.origin);
  }
  function close(receipt?: unknown) {
    const appliedClose =
      applied !== undefined && matchesCartReceipt(receipt, applied) && receipt.authority === 'shopify';
    if (appliedClose) {
      if (completion?.requestId === receipt.requestId) return;
      completion = receipt;
      input.onAppliedClose?.();
      return;
    }
    frame.hidden = true;
    modal.hide();
    focused?.focus();
    input.onClose();
  }
  async function message(event: MessageEvent) {
    if (
      event.source !== frame.contentWindow ||
      event.origin !== window.location.origin ||
      event.data?.channel !== channel
    )
      return;
    const data = event.data;
    if (data.type === 'insignia:designer:preview-failed' && typeof data.url === 'string') {
      input.onPreviewFailure?.(data.url);
      return;
    }
    if (data.type === 'insignia:designer:initialized' && !failed) {
      initializedMessage = true;
      finishInitialization();
      return;
    }
    if (data.type === 'insignia:designer:ready') {
      ready = true;
      send('insignia:designer:init', {
        initial: {
          config: input.config,
          repair: input.repair,
          wording: input.wording,
          locale: input.locale,
          previewOnly: input.previewOnly,
          requiresCartReview: input.requiresCartReview,
          initialDesign: input.initialDesign,
          initialBaseline: input.initialBaseline,
          initialPrints: input.initialPrints,
          initialArtworks: input.initialArtworks,
        },
      });
      return;
    }
    if (
      data.type === 'insignia:designer:repair-action' &&
      typeof data.id === 'string' &&
      ['start', 'remove-group', 'remove-all', 'confirm', 'retry'].includes(data.action)
    ) {
      try {
        if (!input.onRepair) throw new Error('Repair unavailable');
        const value = await input.onRepair(data.action);
        send('insignia:designer:repair-result', { id: data.id, ok: true, value });
      } catch {
        send('insignia:designer:repair-result', { id: data.id, ok: false });
      }
      return;
    }
    if (data.type === 'insignia:designer:navigate-cart') {
      if (completion && applied && matchesCartReceipt(data.receipt, applied) && data.receipt.authority === 'shopify')
        input.onAppliedClose?.();
      return;
    }
    if (data.type === 'insignia:designer:completed') {
      close(data.receipt);
      return;
    }
    if (data.type === 'insignia:designer:closed') {
      close(data.receipt);
      return;
    }
    if (data.type === 'insignia:designer:select-group' && typeof data.id === 'string') {
      input.onSelectGroup?.(data.id);
      return;
    }
    if (data.type === 'insignia:designer:abort' && typeof data.id === 'string') {
      controllers.get(data.id)?.abort();
      return;
    }
    if (data.type !== 'insignia:designer:request' || typeof data.id !== 'string' || controllers.has(data.id)) return;
    const controller = new AbortController();
    controllers.set(data.id, controller);
    try {
      let value: unknown;
      if (data.action === 'upload' && data.file instanceof File && input.ports)
        value = await input.ports.artwork.upload(data.file, {
          ...data.request,
          signal: controller.signal,
          onProgress(phase) {
            if (!controller.signal.aborted && ['uploading', 'processing'].includes(phase))
              send('insignia:designer:progress', { id: data.id, phase });
          },
        } as UploadRequest);
      else if (data.action === 'renew' && data.artwork && input.ports?.artwork.renew)
        value = await input.ports.artwork.renew(data.artwork, { ...data.request, signal: controller.signal });
      else if (data.action === 'prepare' && input.ports?.review)
        value = await input.ports.review.prepare({ ...data.request, signal: controller.signal } as CartRequest);
      else if (data.action === 'commit' && !input.previewOnly && input.ports) {
        committing = controller;
        value = await input.ports.cart.commit({
          ...data.request,
          signal: controller.signal,
          onMutating() {
            if (!controller.signal.aborted) send('insignia:designer:mutating', { id: data.id });
          },
          onPreparing() {
            if (!controller.signal.aborted) send('insignia:designer:preparing', { id: data.id });
          },
        } as CartRequest);
      } else throw new Error('Unsupported designer operation');
      if (!controller.signal.aborted) {
        if (data.action === 'commit' && matchesCartReceipt(value, data.request) && value.authority === 'shopify')
          applied = data.request;
        send('insignia:designer:result', { id: data.id, ok: true, value });
      }
    } catch (error) {
      const status =
        error && typeof error === 'object' && 'status' in error && [403, 404, 410, 422].includes(Number(error.status))
          ? Number(error.status)
          : undefined;
      if (!controller.signal.aborted)
        send('insignia:designer:result', {
          id: data.id,
          ok: false,
          ...(error && typeof error === 'object' && 'reviewRequired' in error && error.reviewRequired === true
            ? { reviewRequired: true, expiresAt: 'expiresAt' in error ? error.expiresAt : undefined }
            : {}),
          ...(status ? { status } : {}),
          ...(data.action === 'commit' && error && typeof error === 'object' && 'cartRejected' in error
            ? {
                cartRejected: true,
                stock: 'stock' in error && error.stock === true,
                ...('detail' in error && typeof error.detail === 'string' ? { detail: error.detail } : {}),
              }
            : {}),
          ...(data.action === 'commit' &&
          error &&
          typeof error === 'object' &&
          'acceptanceOutcome' in error &&
          error.acceptanceOutcome === 'declined'
            ? { acceptanceOutcome: 'declined' }
            : {}),
        });
    } finally {
      controllers.delete(data.id);
      if (data.action === 'commit' && committing === controller) {
        committing = undefined;
        if (pendingRepair && !controller.signal.aborted && !pendingRepair.request?.signal.aborted)
          send('insignia:designer:repair', {
            repair: pendingRepair.value,
            requestId: pendingRepair.request?.requestId,
          });
        pendingRepair = undefined;
      }
    }
  }
  window.addEventListener('message', message);
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clearTimeout(initializationTimer);
    for (const controller of controllers.values()) controller.abort();
    window.removeEventListener('message', message);
    frame.remove();
    modal.destroy();
  }
  return {
    frame,
    get initialized() {
      return initialized && !failed && !destroyed;
    },
    close,
    hide() {
      frame.hidden = true;
      send('insignia:designer:suspend');
      modal.hide();
    },
    repair(value?: { canStart: boolean; canRemoveGroup: boolean; canRemoveAll?: boolean }, request?: CartRequest) {
      if (request?.signal.aborted) return;
      if (committing && value) pendingRepair = { value, request };
      else send('insignia:designer:repair', { repair: value, requestId: request?.requestId });
    },
    error() {
      send('insignia:designer:host-error');
    },
    reviewed() {
      send('insignia:designer:cart-reviewed');
    },
    open() {
      if (destroyed || failed) return false;
      frame.hidden = false;
      modal.show();
      if (ready) send('insignia:designer:open');
      if (initialized) frame.focus();
      return true;
    },
    prices(config: ProductConfig, wording?: MerchantCustomerWordingView, request?: CartRequest) {
      if (request?.signal.aborted) return;
      send('insignia:designer:prices', { config, wording, requestId: request?.requestId });
    },
    previews(colors: ProductConfig['colors']) {
      send('insignia:designer:previews', { colors });
    },
    review(quote: DesignerQuoteReview, request?: CartRequest) {
      if (request?.signal.aborted) return;
      send('insignia:designer:quote', {
        quote: { ...quote, intentId: request?.idempotencyKey },
        requestId: request?.requestId,
      });
    },
    destroy,
  };
}
