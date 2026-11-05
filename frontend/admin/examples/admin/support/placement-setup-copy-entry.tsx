/** Local preview bridge. Kept out of the deployed Products bundle. */
import { render } from 'preact';
import { AdminLocaleProvider, getAdminLocaleController } from '../../../src/shared/admin-i18n.js';
import { launchCustomerPreview } from './placement-customer-preview.mts';
import { readPlacementPreviewProduct, readPlacementSetupExample } from './placement-preview-storage.mts';
import PlacementSetupCopyDialog from './placement-setup-copy-dialog.tsx';
import { createDemoPlacementSetupCopyPorts } from './placement-setup-copy-demo.mts';
import { applyPlacementSetupExample } from './placement-workflow-examples.mts';
import { placementProductSchema } from './placement-workflow-model.mts';

const root = document.createElement('div');
root.id = 'placement-setup-copy-preview';
document.body.append(root);
let open = false;
document.addEventListener('insignia:copy-product-setup', (event) => {
  if (open || !(event instanceof CustomEvent)) return;
  const detail: unknown = event.detail;
  if (!detail || typeof detail !== 'object' || !('targetIds' in detail) || !Array.isArray(detail.targetIds)) return;
  const targetIds = detail.targetIds.filter(
    (id: unknown): id is string => typeof id === 'string' && /^gid:\/\/shopify\/Product\/[1-9][0-9]*$/.test(id),
  );
  if (!targetIds.length || targetIds.length !== detail.targetIds.length) return;
  const origin = document.activeElement;
  open = true;
  render(
    <AdminLocaleProvider controller={getAdminLocaleController(document)}>
      <PlacementSetupCopyDialog
        ports={createDemoPlacementSetupCopyPorts()}
        targetIds={targetIds}
        onClose={() => {
          open = false;
          render(null, root);
          if (!origin?.isConnected)
            requestAnimationFrame(() =>
              document.querySelector<HTMLElement>('.admin-index-toolbar input[type="search"]')?.focus(),
            );
        }}
        onComplete={() => document.dispatchEvent(new Event('insignia:product-setups-copied'))}
      />
    </AdminLocaleProvider>,
    root,
  );
});

// Keep the popup creation inside the originating click; fetch the selected draft afterward.
document.addEventListener('insignia:preview-product', (event) => {
  if (!(event instanceof CustomEvent)) return;
  const detail: unknown = event.detail;
  if (
    !detail ||
    typeof detail !== 'object' ||
    !('productId' in detail) ||
    typeof detail.productId !== 'string' ||
    !/^gid:\/\/shopify\/Product\/[1-9][0-9]*$/.test(detail.productId)
  )
    return;
  const productId = detail.productId;
  launchCustomerPreview(
    async () => {
      const response = await fetch('/__preview/placement-workflow/catalog', { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('The product setup could not be loaded. Try again.');
      const catalog = placementProductSchema.array().parse(await response.json());
      const product = catalog.find((item) => item.id === productId);
      if (!product) throw new Error('This product is unavailable. Refresh Products and try again.');
      const example = readPlacementSetupExample();
      return readPlacementPreviewProduct(example, productId) ?? applyPlacementSetupExample(product, example);
    },
    () =>
      document.dispatchEvent(
        new CustomEvent('insignia:customer-preview-error', { detail: { reason: 'preview-failed' } }),
      ),
    { hostUrl: 'http://127.0.0.1:5173' },
  );
});
