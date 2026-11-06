import { render } from 'preact';
import { MerchantDraftSchema } from '@insignia/contracts';
import { AdminLocaleProvider, getAdminLocaleController } from '../shared/admin-i18n.js';
import { authenticatedJson } from '../shared/admin-request.ts';
import type { ConfigView } from '../shared/admin-view.ts';
import PlacementSetupCopyDialog from '../../examples/admin/support/placement-setup-copy-dialog.tsx';
import { launchCustomerPreview } from '../../examples/admin/support/placement-customer-preview.mts';
import { createSelectedProductCopyPorts } from './selected-product-copy.ts';
import { selectedProductFromConfig } from './selected-product-view.ts';
import '../../examples/admin/support/placement-setup-copy-dialog.css';
import '../../examples/admin/support/placement-setup-copy-review.css';

const productId = (value: unknown): value is string => typeof value === 'string' && /^gid:\/\/shopify\/Product\/[1-9][0-9]*$/.test(value);
/** Real host bridge for the selected Products actions. Demo bridges are installed only by their own host. */
export function installSelectedProductActions(): () => void {
  const storage = window.sessionStorage;
  const mount = document.createElement('div');
  mount.dataset.selectedProductActions = 'true';
  document.body.append(mount);
  let open = false, disposed = false;
  const reportPreviewFailure = () => document.dispatchEvent(new CustomEvent('insignia:customer-preview-error', { detail: { reason: 'preview-failed' } }));
  const copy = (event: Event) => {
    if (disposed || open || !(event instanceof CustomEvent)) return;
    const value: unknown = event.detail;
    if (!value || typeof value !== 'object' || !('targetIds' in value) || !Array.isArray(value.targetIds) || !value.targetIds.length || value.targetIds.length > 100 || !value.targetIds.every(productId) || new Set(value.targetIds).size !== value.targetIds.length) return;
    const targetIds: string[] = value.targetIds;
    const origin = document.activeElement;
    open = true;
    const ports = createSelectedProductCopyPorts({ storage });
    render(<AdminLocaleProvider controller={getAdminLocaleController(document)}><PlacementSetupCopyDialog ports={ports} targetIds={targetIds} onClose={() => {
      open = false; render(null, mount);
      if (origin instanceof HTMLElement && origin.isConnected) origin.focus();
    }} onComplete={() => document.dispatchEvent(new Event('insignia:product-setups-copied'))} /></AdminLocaleProvider>, mount);
  };
  const preview = (event: Event) => {
    if (disposed || !(event instanceof CustomEvent)) return;
    const value: unknown = event.detail;
    if (!value || typeof value !== 'object' || !('productId' in value) || !productId(value.productId)) return;
    const id = value.productId;
    launchCustomerPreview(async () => {
      const result = await authenticatedJson<unknown>(`/api/admin/products/${id.split('/').at(-1)}/config`);
      if (!result || typeof result !== 'object' || !('product' in result) || !('config' in result)) throw new Error('Product preview unavailable');
      const view = result as ConfigView;
      if (view.product.id !== id) throw new Error('Product preview identity changed');
      if (view.config) MerchantDraftSchema.parse(view.config.draft);
      return selectedProductFromConfig(view);
    }, reportPreviewFailure);
  };
  document.addEventListener('insignia:copy-product-setup', copy);
  document.addEventListener('insignia:preview-product', preview);
  return () => {
    disposed = true;
    document.removeEventListener('insignia:copy-product-setup', copy);
    document.removeEventListener('insignia:preview-product', preview);
    render(null, mount); mount.remove();
  };
}
