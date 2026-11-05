/** Loopback-only scenario adapter for the production MerchantHome island. */
import { render } from 'preact';
import { useRef, useState } from 'preact/hooks';
import MerchantHome from '../../../src/islands/MerchantHome.js';
import { AdminLocaleProvider, getAdminLocaleController } from '../../../src/shared/admin-i18n.js';
import {
  homeGuidanceCompletedSteps,
  homeGuidanceIsDismissed,
  homePreferenceStorage,
  saveHomeGuidanceCompletedSteps,
  saveHomeGuidanceDismissed,
} from '../../../src/shared/home-guidance-preference.js';
import type { HomePanel, MerchantHomeModel } from '../../../src/shared/merchant-home.js';
import { type HomeExampleId, homeExample, homeExamples } from './home-preview-fixtures.mts';

const requestedExample = new URLSearchParams(window.location.search).get('__home_example') ?? 'operating';
const example = homeExamples.find(([id]) => id === requestedExample)?.[0] ?? 'operating';
const mount = document.getElementById('home-workflow-preview');
const guidanceShop = 'insignia-home-preview.myshopify.com';

function markRetry(panel: HomePanel, count: number, outcome: 'failed' | 'recovered') {
  mount?.setAttribute('data-home-preview-retry-count', String(count));
  mount?.setAttribute('data-home-preview-last-retry', panel);
  mount?.setAttribute('data-home-preview-retry-outcome', outcome);
}

function HomePreview() {
  const [model, setModel] = useState<MerchantHomeModel>(() => {
    const next = homeExample(example);
    if (next.state === 'ready' && next.guidance) {
      const stored = homeGuidanceCompletedSteps(homePreferenceStorage(), guidanceShop);
      return {
        ...next,
        guidance: {
          ...next.guidance,
          dismissed: next.guidance.dismissed || homeGuidanceIsDismissed(homePreferenceStorage(), guidanceShop),
          completedSteps: [...new Set([...(next.guidance.completedSteps ?? []), ...stored])],
        },
      };
    }
    return next;
  });
  const dismissGuidance = (dismissed: boolean) => {
    saveHomeGuidanceDismissed(homePreferenceStorage(), guidanceShop, dismissed);
    setModel((current) =>
      current.state === 'ready' && current.guidance
        ? { ...current, guidance: { ...current.guidance, dismissed } }
        : current,
    );
  };
  const attempts = useRef<Record<HomePanel, number>>({ products: 0, orders: 0 });

  const retry = async (panel: HomePanel) => {
    const attempt = attempts.current[panel] + 1;
    attempts.current[panel] = attempt;
    const failOnce = example === 'retry-fail-then-recovery' && panel === 'orders' && attempt === 1;
    markRetry(panel, attempt, failOnce ? 'failed' : 'recovered');
    await new Promise<void>((resolve) => window.setTimeout(resolve, 180));

    if (failOnce) throw new Error('The local retry example remains unavailable on its first attempt.');

    const recovered = homeExample(panel === 'products' ? 'draft' : 'operating');
    if (recovered.state !== 'ready') throw new Error('The local recovery example is invalid.');
    if (panel === 'products') {
      setModel((current) => (current.state === 'ready' ? { ...current, products: recovered.products } : current));
    } else {
      setModel((current) => (current.state === 'ready' ? { ...current, orders: recovered.orders } : current));
    }
  };

  const createProduct = async () => {
    if (example === 'create-product-error') {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 180));
      throw new Error('The simulated Shopify handoff could not be opened.');
    }
    if (example === 'create-product-pending') {
      return new Promise<void>(() => {});
    }
    (window.top ?? window).location.assign('/__preview/home/create-product-handoff');
  };

  return (
    <MerchantHome
      model={model}
      onRetry={retry}
      onCreateProduct={createProduct}
      onDismissGuidance={() => dismissGuidance(true)}
      onRestoreGuidance={() => dismissGuidance(false)}
      onCompleteGuidanceStep={(step, complete) =>
        setModel((current) => {
          if (current.state !== 'ready' || !current.guidance) return current;
          const previous = current.guidance.completedSteps ?? [];
          const completedSteps = complete ? [...new Set([...previous, step])] : previous.filter((id) => id !== step);
          saveHomeGuidanceCompletedSteps(homePreferenceStorage(), guidanceShop, completedSteps);
          return { ...current, guidance: { ...current.guidance, completedSteps } };
        })
      }
    />
  );
}

function installExamplePicker(activeExample: HomeExampleId): void {
  if (window.location.pathname !== '/admin/home') return;
  try {
    const outerWindow = window.top;
    if (!outerWindow) return;
    const outerDocument = outerWindow.document;
    const footer = outerDocument.querySelector<HTMLElement>('footer[data-demo-controls]');
    if (!footer || footer.querySelector('[data-home-example-control]')) return;

    if (!outerDocument.querySelector('style[data-home-example-style]')) {
      const style = outerDocument.createElement('style');
      style.dataset.homeExampleStyle = 'true';
      style.textContent =
        '[data-home-example-control]{width:210px;max-width:100%}@media(max-width:480px){[data-home-example-control]{flex:1;min-width:180px;width:auto}}';
      outerDocument.head.append(style);
    }

    const control = outerDocument.createElement('div');
    control.dataset.homeExampleControl = 'true';
    const select = outerDocument.createElement('s-select') as HTMLElementTagNameMap['s-select'];
    select.setAttribute('data-home-example-select', '');
    select.setAttribute('label', 'Home example');
    select.setAttribute('labelAccessibilityVisibility', 'exclusive');
    for (const [id, label] of homeExamples) {
      const option = outerDocument.createElement('s-option');
      option.setAttribute('value', id);
      option.textContent = label;
      select.append(option);
    }
    select.value = activeExample;
    select.addEventListener('change', () => {
      const nextExample = select.value;
      if (!nextExample || !homeExamples.some(([id]) => id === nextExample)) return;
      const url = new URL(outerWindow.location.href);
      url.searchParams.set('__home_example', nextExample);
      outerWindow.location.assign(url.href);
    });
    control.append(select);
    const before = footer.querySelector('[data-demo-picker]');
    footer.insertBefore(control, before ?? footer.firstChild);
  } catch {
    // The preview remains readable when it is opened outside the local host shell.
  }
}

if (mount)
  render(
    <AdminLocaleProvider controller={getAdminLocaleController(document)}>
      <HomePreview />
    </AdminLocaleProvider>,
    mount,
  );
installExamplePicker(example);

// Native Shopify links are represented by an explicit local handoff outside the embedded preview.
document.addEventListener(
  'click',
  (event) => {
    const source = event
      .composedPath()
      .find((node): node is Element => node instanceof Element && node.matches('s-link[href],s-button[href]'));
    if (source?.getAttribute('href') !== 'shopify://admin/products') return;
    event.preventDefault();
    (window.top ?? window).location.assign('/__preview/home/create-product-handoff?mode=products');
  },
  { capture: true },
);
