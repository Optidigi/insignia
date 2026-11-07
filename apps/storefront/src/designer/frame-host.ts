import type { MerchantCustomerWordingView } from '@insignia/contracts';
import type { ProductConfig } from '../../../../frontend/designer/src/config';
import type { Artwork, Design, Print } from '../../../../frontend/designer/src/model';
import type { DesignerQuoteReview } from '../../../../frontend/designer/src/quote-review';
import {
  type CartRequest,
  type DesignerPorts,
  matchesCartReceipt,
  type UploadRequest,
} from '../../../../frontend/designer/src/runtime';
import type { RepairAction } from './repair';

const escapeAttribute = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
/** Run the selected CSS and event handlers in their own document, never in the Shopify theme. */
export function createDesignerFrame(input: {
  config?: ProductConfig;
  title?: string;
  wording?: MerchantCustomerWordingView;
  ports?: DesignerPorts;
  locale?: string;
  previewOnly?: boolean;
  requiresCartReview?: boolean;
  initialDesign?: Design;
  initialPrints?: Print[];
  initialArtworks?: Artwork[];
  repair?: { canStart: boolean; canRemoveGroup: boolean; canRemoveAll?: boolean };
  onRepair?: (action: RepairAction) => Promise<DesignerQuoteReview | undefined>;
  onClose(): void;
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
  const assetsBase = new URL(import.meta.url);
  assetsBase.pathname = assetsBase.pathname.slice(0, assetsBase.pathname.lastIndexOf('/') + 1);
  assetsBase.search = '';
  assetsBase.hash = '';
  const entry = new URL('insignia-designer-frame.js', assetsBase);
  const css = new URL('insignia-designer.css', assetsBase);
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="origin"><link rel="stylesheet" href="${escapeAttribute(css.href)}"></head><body><script type="module" src="${escapeAttribute(entry.href)}"></script></body></html>`;
  const controllers = new Map<string, AbortController>();
  const previousOverflow = document.documentElement.style.overflow;
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let ready = false;
  let applied: CartRequest | undefined;
  function send(type: string, data: Record<string, unknown> = {}) {
    frame.contentWindow?.postMessage({ type, channel, ...data }, window.location.origin);
  }
  function close(receipt?: unknown) {
    const appliedClose =
      applied !== undefined && matchesCartReceipt(receipt, applied) && receipt.authority === 'shopify';
    applied = undefined;
    frame.hidden = true;
    document.documentElement.style.overflow = previousOverflow;
    focused?.focus();
    input.onClose();
    if (appliedClose) input.onAppliedClose?.();
  }
  async function message(event: MessageEvent) {
    if (
      event.source !== frame.contentWindow ||
      event.origin !== window.location.origin ||
      event.data?.channel !== channel
    )
      return;
    const data = event.data;
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
        } as UploadRequest);
      else if (data.action === 'prepare' && input.ports?.review)
        value = await input.ports.review.prepare({ ...data.request, signal: controller.signal } as CartRequest);
      else if (data.action === 'commit' && !input.previewOnly && input.ports)
        value = await input.ports.cart.commit({ ...data.request, signal: controller.signal } as CartRequest);
      else throw new Error('Unsupported designer operation');
      if (!controller.signal.aborted) {
        if (data.action === 'commit' && matchesCartReceipt(value, data.request) && value.authority === 'shopify')
          applied = data.request;
        send('insignia:designer:result', { id: data.id, ok: true, value });
      }
    } catch {
      if (!controller.signal.aborted) send('insignia:designer:result', { id: data.id, ok: false });
    } finally {
      controllers.delete(data.id);
    }
  }
  window.addEventListener('message', message);
  document.documentElement.style.overflow = 'hidden';
  document.body.append(frame);
  return {
    frame,
    close,
    hide() {
      frame.hidden = true;
    },
    repair(value?: { canStart: boolean; canRemoveGroup: boolean; canRemoveAll?: boolean }) {
      send('insignia:designer:repair', { repair: value });
    },
    error() {
      send('insignia:designer:host-error');
    },
    reviewed() {
      send('insignia:designer:cart-reviewed');
    },
    open() {
      if (ready) {
        frame.hidden = false;
        document.documentElement.style.overflow = 'hidden';
        send('insignia:designer:open');
        frame.focus();
      }
    },
    prices(config: ProductConfig, wording?: MerchantCustomerWordingView) {
      send('insignia:designer:prices', { config, wording });
    },
    review(quote: DesignerQuoteReview) {
      send('insignia:designer:quote', { quote });
    },
    destroy() {
      for (const controller of controllers.values()) controller.abort();
      window.removeEventListener('message', message);
      frame.remove();
      document.documentElement.style.overflow = previousOverflow;
    },
  };
}
