/** Explicit loopback-only preview controls and fake consent outcomes. No native authority. */
import {
  createTranslationsPreviewStoragePort,
  type StorefrontPreviewProduct,
  settingsArea,
  settingsExamples,
  storefrontProductsForExample,
} from './settings-preview-fixtures.mts';

type PreviewResourcePickerOptions = {
  type: 'product';
  action: 'select';
  multiple?: false;
  filter?: { variants?: false; hidden?: false; draft?: false; archived?: false };
  selectionIds?: readonly { id: string }[];
};
type PreviewModal = HTMLElement & { showOverlay(): void; hideOverlay(): void };
type PreviewChoiceList = HTMLElement & { values: string[] };
type PreviewButton = HTMLElement & { disabled: boolean };

async function openLocalProductPicker(
  options: PreviewResourcePickerOptions,
  example: string,
): Promise<StorefrontPreviewProduct[] | undefined> {
  await Promise.all(
    ['s-modal', 's-choice-list', 's-choice', 's-button'].map((name) => customElements.whenDefined(name)),
  );
  const products = storefrontProductsForExample(example);
  let selectedProduct = products.find((product) => options.selectionIds?.some(({ id }) => id === product.id));
  const modal = document.createElement('s-modal') as PreviewModal;
  modal.id = 'settings-preview-product-picker';
  modal.setAttribute('heading', 'Choose a product');
  modal.setAttribute('size', 'base');
  modal.setAttribute('accessibilityLabel', 'Choose a product in the local preview');

  const note = document.createElement('s-paragraph');
  note.setAttribute('color', 'subdued');
  note.textContent = 'Local preview only. Choose a product from the demo catalog.';

  const choiceList = document.createElement('s-choice-list') as PreviewChoiceList;
  choiceList.setAttribute('label', 'Products');
  choiceList.setAttribute('name', 'storefront-preview-product');
  for (const product of products) {
    const choice = document.createElement('s-choice');
    choice.setAttribute('value', product.id);
    if (product.id === selectedProduct?.id) choice.setAttribute('selected', '');
    choice.textContent = product.title;
    choiceList.append(choice);
  }

  const cancelButton = document.createElement('s-button') as PreviewButton;
  cancelButton.setAttribute('slot', 'secondary-actions');
  cancelButton.setAttribute('variant', 'secondary');
  cancelButton.textContent = 'Cancel';

  const selectButton = document.createElement('s-button') as PreviewButton;
  selectButton.setAttribute('slot', 'primary-action');
  selectButton.setAttribute('variant', 'primary');
  selectButton.textContent = 'Select';
  selectButton.disabled = !selectedProduct;

  choiceList.addEventListener('change', () => {
    selectedProduct = products.find((product) => product.id === choiceList.values[0]);
    selectButton.disabled = !selectedProduct;
  });

  let result: StorefrontPreviewProduct[] | undefined;
  let selectionMade = false;
  let resolved = false;
  let tornDown = false;
  let resolvePicker: (value: StorefrontPreviewProduct[] | undefined) => void = () => {};
  const resultPromise = new Promise<StorefrontPreviewProduct[] | undefined>((resolve) => {
    resolvePicker = resolve;
  });
  function teardown() {
    if (tornDown) return;
    tornDown = true;
    modal.removeEventListener('hide', onHide);
    modal.removeEventListener('afterhide', onAfterHide);
    window.removeEventListener('pagehide', onPageHide);
    cancelButton.removeEventListener('click', hide);
    selectButton.removeEventListener('click', select);
    modal.remove();
  }
  function resolveOnce() {
    if (resolved) return;
    resolved = true;
    teardown();
    resolvePicker(result);
  }
  function onHide() {
    if (!selectionMade) result = undefined;
  }
  function onAfterHide() {
    resolveOnce();
  }
  function onPageHide() {
    result = undefined;
    resolveOnce();
  }
  function hide() {
    modal.hideOverlay();
  }
  function select() {
    if (!selectedProduct) return;
    selectionMade = true;
    result = [{ ...selectedProduct }];
    modal.hideOverlay();
  }
  cancelButton.addEventListener('click', hide);
  selectButton.addEventListener('click', select);
  modal.addEventListener('hide', onHide);
  modal.addEventListener('afterhide', onAfterHide, { once: true });
  window.addEventListener('pagehide', onPageHide, { once: true });
  modal.append(note, choiceList, cancelButton, selectButton);
  document.body.append(modal);
  modal.showOverlay();
  return resultPromise;
}

const area = settingsArea(location.pathname);
const exampleParameter = area === 'translations' ? '__translations_example' : '__settings_example';
const example =
  new URLSearchParams(location.search).get(exampleParameter) ?? (area ? settingsExamples[area][0][0] : 'initial');
const checkoutScopes = ['read_cart_transforms', 'read_validations'];
const productScopes = ['write_products', 'read_publications'];
const allScopes = [
  ...productScopes,
  ...checkoutScopes,
  'read_orders',
  'write_cart_transforms',
  'write_validations',
  'write_app_proxy',
  'read_markets',
];
const granted = new Set(
  allScopes.filter(
    (scope) =>
      !(example === 'product-missing' && productScopes.includes(scope)) &&
      !(['missing', 'declined', 'uncertain'].includes(example) && checkoutScopes.includes(scope)),
  ),
);
const detail = () => ({
  granted: [...granted],
  optional: [...productScopes, ...checkoutScopes].filter((scope) => !granted.has(scope)),
  required: [],
});
const previewWindow = window as unknown as {
  shopify: {
    config: { locale: string; shop?: string };
    app?: { extensions(): Promise<unknown> };
    resourcePicker?: (options: PreviewResourcePickerOptions) => Promise<StorefrontPreviewProduct[] | undefined>;
    idToken(): Promise<string>;
    loading(): void;
    scopes: {
      query(): Promise<ReturnType<typeof detail>>;
      request(scopes: string[]): Promise<{ result: string; detail: ReturnType<typeof detail> }>;
    };
  };
};
previewWindow.shopify = {
  config: {
    locale: new URL(location.href).searchParams.get('locale') ?? 'en-GB',
    ...(['storefront', 'translations'].includes(area ?? '') && example !== 'outside'
      ? { shop: 'insignia-preview.myshopify.com' }
      : {}),
  },
  idToken: async () => 'LOCAL-SYNTHETIC-PREVIEW',
  loading: () => {},
  scopes: {
    query: async () => {
      if (example === 'error') throw new Error('Synthetic access unavailable');
      return detail();
    },
    request: async (scopes) => {
      if (!area) throw new Error('Local preview cannot request Shopify permissions');
      if (example === 'uncertain') throw new Error('Synthetic result unknown');
      if (example === 'declined') return { result: 'declined-all', detail: detail() };
      for (const scope of scopes) granted.add(scope);
      return { result: 'granted-all', detail: detail() };
    },
  },
};

// Local-only storage-port fixtures. The initial scenario deliberately uses the
// real browser storage port so edits survive a reload in the preview.
function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

if (area === 'translations' && example !== 'initial' && isLoopbackHost(location.hostname)) {
  const readOnly = example === 'read-only';
  const storagePort = createTranslationsPreviewStoragePort(example);
  (
    window as unknown as {
      __insigniaCustomerTranslationsPreview?: {
        example: string;
        readOnly: boolean;
        storagePort: typeof storagePort;
      };
    }
  ).__insigniaCustomerTranslationsPreview = { example, readOnly, storagePort };
}

if (area === 'storefront' && example !== 'outside') {
  // Loopback-only stand-in for App Bridge ResourcePicker. This modal is preview support, not shipped product UI.
  let pickerOpen = false;
  previewWindow.shopify.resourcePicker = async (options) => {
    if (pickerOpen || options.type !== 'product' || options.action !== 'select') return undefined;
    pickerOpen = true;
    try {
      return await openLocalProductPicker(options, example);
    } finally {
      pickerOpen = false;
    }
  };
}

if (area === 'storefront') {
  let attempts = 0;
  const isProductTestExample = example.startsWith('test-');
  if (example !== 'unsupported')
    previewWindow.shopify.app = {
      extensions: async () => {
        attempts++;
        if (example === 'error' && attempts === 1) throw new Error('Synthetic theme check unavailable');
        if (example === 'unknown') return [];
        const block = (handle: string, active: boolean) => ({
          handle,
          name: handle,
          target: handle === 'customize' ? 'section' : 'body',
          status: example === 'unavailable' && handle === 'customize' ? 'unavailable' : active ? 'active' : 'available',
          activations: active
            ? [
                {
                  target: handle === 'customize' ? 'template--product/main/insignia' : 'theme',
                  themeId: 'gid://shopify/OnlineStoreTheme/123',
                },
              ]
            : [],
        });
        return [
          {
            handle: 'insignia',
            type: 'theme_app_extension',
            activations: [
              block('customize', isProductTestExample || ['active', 'button-added'].includes(example)),
              block('cart-repair', isProductTestExample || ['active', 'cart-enabled'].includes(example)),
            ],
          },
        ];
      },
    };
  // Only the loopback demonstration intercepts synthetic Shopify links. The shipped UI
  // retains real theme editor deep links; this preview cannot modify a merchant theme.
  document.addEventListener(
    'click',
    (event) => {
      const control = event
        .composedPath()
        .find((node): node is Element => node instanceof Element && node.matches('s-button[href], a[href]'));
      const href = control?.getAttribute('href');
      if (!href) return;
      const url = new URL(href, location.href);
      if (url.hostname !== 'insignia-preview.myshopify.com' || url.pathname !== '/admin/themes/current/editor') return;
      event.preventDefault();
      const handoff = new URL('/__preview/settings/theme-handoff', location.origin);
      handoff.searchParams.set(
        'task',
        url.searchParams.has('addAppBlockId')
          ? 'button'
          : url.searchParams.has('activateAppId')
            ? 'cart'
            : url.searchParams.has('previewPath')
              ? 'preview'
              : 'editor',
      );
      handoff.searchParams.set('example', example);
      if (control?.getAttribute('target') === '_blank') window.open(handoff.href, '_blank', 'noopener,noreferrer');
      else window.top?.location.assign(handoff.href);
    },
    true,
  );
}

if (area === 'translations') {
  document.addEventListener(
    'click',
    (event) => {
      const control = event
        .composedPath()
        .find(
          (node): node is Element => node instanceof Element && node.matches('s-button[href], s-link[href], a[href]'),
        );
      if (control?.getAttribute('href') !== 'shopify://admin/settings/languages') return;
      event.preventDefault();
      const handoff = new URL('/__preview/settings/language-handoff', location.origin);
      handoff.searchParams.set('example', example);
      window.top?.location.assign(handoff.href);
    },
    true,
  );
}

if (area) {
  const original = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const storefrontProductConfig =
      area === 'storefront' && /^\/api\/admin\/products\/(?:15464675246464|15468416336256)\/config$/.test(url.pathname);
    if (
      url.origin === location.origin &&
      (['/api/admin/billing', '/api/admin/readiness'].includes(url.pathname) ||
        url.pathname.startsWith('/api/purchases/v1/privacy') ||
        storefrontProductConfig)
    ) {
      url.searchParams.set(
        '__settings_example',
        example === 'product-missing' && productScopes.every((scope) => granted.has(scope)) ? 'allowed' : example,
      );
      return original(new Request(url, request));
    }
    return original(request);
  };
}

// The surrounding preview shell owns the scenario picker, never the product UI.
if (window === window.top && area) {
  window.addEventListener('DOMContentLoaded', () => {
    const footer = document.querySelector('footer[data-demo-controls]');
    if (!footer) return;
    const label = document.createElement('label');
    const exampleLabel = area === 'translations' ? 'Translations example' : 'Settings example';
    label.textContent = `${exampleLabel} `;
    const select = document.createElement('select');
    select.setAttribute('aria-label', exampleLabel);
    for (const [value, text] of settingsExamples[area]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      select.append(option);
    }
    select.value = example;
    select.addEventListener('change', () => {
      const url = new URL(location.href);
      url.searchParams.set(exampleParameter, select.value);
      location.assign(url);
    });
    label.append(select);
    footer.replaceChildren(label);
  });
}
