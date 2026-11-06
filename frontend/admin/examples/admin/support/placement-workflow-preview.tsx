/** Loopback-only product editor composition. */
import { render } from 'preact';
import { useAdminLocale, AdminLocaleProvider, getAdminLocaleController } from '../../../src/shared/admin-i18n.js';
import { PlacementEditor } from '../../../src/islands/SelectedProductEditor.tsx';
import { placementProductSchema } from './placement-workflow-model.mts';
import { readPlacementPreviewProduct, readPlacementPreviewState, readPlacementSetupExample, writePlacementPreviewProduct } from './placement-preview-storage.mts';
import { publishPlacementPreviewProduct } from './placement-publication.mts';
import { launchCustomerPreview } from './placement-customer-preview.mts';
import { loadPlacementMethodCatalog } from './placement-method-library.mts';
import { createDemoPlacementSetupCopyPorts } from './placement-setup-copy-demo.mts';
import { applyPlacementSetupExample } from './placement-workflow-examples.mts';
const setupExample = readPlacementSetupExample;
async function start() {
  const root = document.getElementById('placement-workflow-preview');
  if (!root) return;
  try {
    await Promise.all(
      ['s-page', 's-number-field', 's-money-field', 's-modal', 's-empty-state', 's-drop-zone', 's-image'].map((tag) =>
        customElements.whenDefined(tag),
      ),
    );
    const id = location.pathname.match(/\/products\/(\d+)\/config/)?.[1];
    const response = await fetch(`/__preview/placement-workflow/data?product=${id ?? ''}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Product unavailable');
    let data = placementProductSchema.parse(await response.json());
    const example = setupExample();
    data = applyPlacementSetupExample(data, example);
    const stored = readPlacementPreviewProduct(example, data.id);
    // Product identity comes from the catalog, even when a saved draft used an older title.
    if (stored) data = { ...stored, title: data.title };
    root.removeAttribute('role');
    root.removeAttribute('aria-label');
    render(
      <AdminLocaleProvider controller={getAdminLocaleController(document)}>
        <PlacementEditor initial={data} adapter={{ kind: 'demo', currency: 'EUR', selectionScope: example,
          publication: readPlacementPreviewState(example, data.id), revision: () => readPlacementPreviewState(example, data.id)?.revision ?? 0,
          pending: () => false, loadMethods: loadPlacementMethodCatalog, copyPorts: createDemoPlacementSetupCopyPorts(), preview: (source, error, options) => launchCustomerPreview(source, error, { ...options, hostUrl: 'http://127.0.0.1:5173' }),
          save: async (product) => { if (!writePlacementPreviewProduct(example, product)) throw new Error('Demo storage unavailable'); },
          publish: async (product, revision) => publishPlacementPreviewProduct(example, product, undefined, revision),
        }} />
      </AdminLocaleProvider>,
      root,
    );
  } catch {
    document.documentElement.dataset.adminContentReady = 'true';
    document.dispatchEvent(new Event('insignia:admin-ready'));
    render(
      <AdminLocaleProvider controller={getAdminLocaleController(document)}>
        <PlacementPreviewLoadFailure onRetry={() => void start()} />
      </AdminLocaleProvider>,
      root,
    );
  }
}

function PlacementPreviewLoadFailure({ onRetry }: { onRetry(): void }) {
  const { t } = useAdminLocale();
  return (
    <s-page heading={t('editor:placementWorkflowPreview.productSetup')}>
      <s-link slot="breadcrumb-actions" href="/admin/products">
        {t('editor:placementWorkflowPreview.products')}
      </s-link>
      <s-banner tone="critical" heading={t('editor:placementWorkflowPreview.productCouldNotBeLoaded')}>
        {t('editor:placementWorkflowPreview.tryReloadingPage')}
      </s-banner>
      <s-button onClick={onRetry}>{t('common:actions.retry')}</s-button>
    </s-page>
  );
}
void start();
