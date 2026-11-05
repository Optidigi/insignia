/** Loopback demo composition; production uses SelectedMethods through real ports. */
import { render } from 'preact';
import SelectedMethods from '../../../src/islands/SelectedMethods.tsx';
import { AdminLocaleProvider, getAdminLocaleController, useAdminLocale } from '../../../src/shared/admin-i18n.js';
import { methodPreviewSchema } from './method-configuration.mts';
import { methodCatalogStorageKey } from './placement-method-library.mts';
import { projectMethodProducts } from './method-product-setups.mts';
import { readPlacementSetupExample, resolvePlacementPreviewStorage } from './placement-preview-storage.mts';
import { placementProductSchema } from './placement-workflow-model.mts';
function largeCatalog() { try { return sessionStorage.getItem('insignia-method-catalog') === 'large'; } catch { return false; } }
const storageKey = methodCatalogStorageKey(largeCatalog());
async function start() {
  const root = document.getElementById('method-workflow-preview');
  if (!root) return;
  await Promise.all(
    ['s-page', 's-modal', 's-choice-list', 's-money-field'].map((tag) => customElements.whenDefined(tag)),
  );
  try {
    const response = await fetch(`/__preview/method-workflow/data${largeCatalog() ? '?catalog=large' : ''}`);
    if (!response.ok) throw new Error('Preview data unavailable');
    const data = methodPreviewSchema.parse(await response.json());
    root.removeAttribute('role');
    root.removeAttribute('aria-label');
    let methods = data.methods;
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) methods = methodPreviewSchema.shape.methods.parse(JSON.parse(stored));
    } catch {
      /* Ignore obsolete or unavailable local preview storage. */
    }
    let products = data.products;
    if (!largeCatalog()) {
      const catalog = await fetch('/__preview/placement-workflow/catalog');
      if (!catalog.ok) throw new Error('Product setup could not be loaded.');
      const placements = placementProductSchema.array().parse(await catalog.json());
      products = projectMethodProducts(
        products,
        placements,
        readPlacementSetupExample(),
        resolvePlacementPreviewStorage(),
      );
    }
    render(
      <AdminLocaleProvider controller={getAdminLocaleController(document)}>
        <SelectedMethods initial={methods} products={products} persist={async (next) => { sessionStorage.setItem(storageKey, JSON.stringify(next)); }} />
      </AdminLocaleProvider>,
      root,
    );
  } catch {
    root.removeAttribute('role');
    root.removeAttribute('aria-label');
    document.documentElement.dataset.adminContentReady = 'true';
    document.dispatchEvent(new Event('insignia:admin-ready'));
    render(
      <AdminLocaleProvider controller={getAdminLocaleController(document)}>
        <MethodPreviewLoadFailure onRetry={() => void start()} />
      </AdminLocaleProvider>,
      root,
    );
  }
}

function MethodPreviewLoadFailure({ onRetry }: { onRetry(): void }) {
  const { t } = useAdminLocale();
  return (
    <s-page heading={t('methods:workflow.title')}>
      <s-section>
        <s-stack gap="base">
          <s-banner tone="critical">{t('methods:workflow.empty.loadFailure')}</s-banner>
          <s-button onClick={onRetry}>{t('common:actions.retry')}</s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}
void start();
