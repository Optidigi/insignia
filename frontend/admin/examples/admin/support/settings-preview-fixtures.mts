/** Local-only UI scenarios. Never grants access, changes billing or creates privacy requests. */
import type { BillingView } from '../../../src/shared/billing-view.js';
import { draft, response as productConfigResponse } from './product-fixture.mts';

export type StorefrontPreviewProduct = {
  id: string;
  title: string;
  handle: string;
  templateSuffix: string | null;
};

export const storefrontPreviewProducts = [
  {
    id: 'gid://shopify/Product/15464675246464',
    title: 'Ontwerp je eigen superfunny T-shirt',
    handle: 'organic-cotton-t-shirt',
    templateSuffix: null,
  },
  {
    id: 'gid://shopify/Product/15468416336256',
    title: 'Ontwerp je eigen Superfunny hoodie',
    handle: 'classic-hoodie',
    templateSuffix: 'team',
  },
] as const satisfies readonly StorefrontPreviewProduct[];

export const storefrontLongProductTitle =
  'Organic cotton heavyweight relaxed-fit unisex T-shirt with a reinforced rib-knit crew neck, substantial midweight jersey, garment-dyed finish, soft washed texture, responsibly sourced fibres, durable stitching, and a relaxed silhouette for everyday layering.';

export function storefrontProductsForExample(example: string): StorefrontPreviewProduct[] {
  return storefrontPreviewProducts.map((product) => ({
    ...product,
    ...(example === 'test-long-title' && product.id === 'gid://shopify/Product/15464675246464'
      ? { title: storefrontLongProductTitle }
      : {}),
  }));
}

export const settingsExamples = {
  storefront: [
    ['not-added', 'Before adding Insignia'],
    ['button-added', 'Customization button added'],
    ['cart-enabled', 'Cart review enabled first'],
    ['active', 'Both active in the published theme'],
    ['unavailable', 'Item unavailable'],
    ['unknown', 'Theme status not available'],
    ['unsupported', 'Status check not supported'],
    ['error', 'Check failed with retry'],
    ['outside', 'Open outside Shopify'],
    ['test-published', 'Product test ready'],
    ['test-unpublished', 'Product customizations not published'],
    ['test-error', 'Product status check failed'],
    ['test-denied', 'Product access denied'],
    ['test-long-title', 'Product test with long title'],
  ],
  billing: [
    ['trial', 'Trial'],
    ['active', 'Active subscription'],
    ['discounted', 'Subscription discount'],
    ['development', 'Development test terms'],
    ['cancelling', 'Cancellation scheduled'],
    ['pending', 'Change pending'],
    ['inactive', 'No active subscription'],
    ['unverified', 'Status not verified'],
    ['error', 'Service unavailable'],
    ['denied', 'Access unavailable'],
    ['expired', 'Session expired'],
  ],
  permissions: [
    ['initial', 'Before checking access'],
    ['allowed', 'Access available'],
    ['product-missing', 'Product setup permission needed'],
    ['missing', 'Permission needed'],
    ['view-only', 'View-only staff access'],
    ['declined', 'Permission declined'],
    ['uncertain', 'Permission result unknown'],
    ['error', 'Check unavailable'],
    ['denied', 'Access unavailable'],
    ['expired', 'Session expired'],
  ],
  translations: [
    ['initial', 'No translations yet'],
    ['loading', 'Translations loading'],
    ['load-error', 'Language list unavailable'],
    ['save-error', 'Save failed with edits retained'],
    ['read-only', 'View-only staff access'],
  ],
} as const;

export type TranslationsPreviewStoragePort = {
  read(): Promise<unknown | null>;
  write(record: unknown): Promise<void>;
  remove(): Promise<void>;
};

/** Local error/loading ports used only by the settings preview harness. */
export function createTranslationsPreviewStoragePort(example: string): TranslationsPreviewStoragePort {
  let storedRecord: unknown | null = null;
  const readOnly = example === 'read-only';
  return {
    read() {
      if (example === 'loading') return new Promise<never>(() => {});
      if (example === 'load-error') return Promise.reject(new Error('Synthetic translations read failed'));
      return Promise.resolve(storedRecord);
    },
    async write(record) {
      if (example === 'save-error') throw new Error('Synthetic translations save failed');
      if (readOnly) throw new Error('Synthetic translations storage is read-only');
      storedRecord = record;
    },
    async remove() {
      if (readOnly) throw new Error('Synthetic translations storage is read-only');
      storedRecord = null;
    },
  };
}

export function settingsArea(path: string): keyof typeof settingsExamples | null {
  return path === '/admin/settings/billing'
    ? 'billing'
    : path === '/admin/settings/permissions'
      ? 'permissions'
      : path === '/admin/settings/storefront'
        ? 'storefront'
        : path === '/admin/settings/translations'
          ? 'translations'
          : null;
}
export function settingsPreviewResponse(path: string, example: string): { status: number; body: unknown } | undefined {
  const productConfigPath = /^\/api\/admin\/products\/(15464675246464|15468416336256)\/config$/.exec(path);
  const productTestExamples = ['test-published', 'test-unpublished', 'test-error', 'test-denied', 'test-long-title'];
  if (productConfigPath && productTestExamples.includes(example)) {
    if (example === 'test-error' || example === 'test-denied')
      return {
        status: example === 'test-denied' ? 403 : 503,
        body: { code: example === 'test-denied' ? 'FORBIDDEN' : 'UNAVAILABLE' },
      };
    const id = productConfigPath[1];
    const product = storefrontProductsForExample(example).find((candidate) => candidate.id.endsWith(`/${id}`));
    if (!product) return;
    const base = productConfigResponse(draft());
    return {
      status: 200,
      body: {
        ...base,
        product: { ...base.product, id: product.id, title: product.title },
        config:
          example === 'test-unpublished'
            ? null
            : {
                ...base.config,
                publication: {
                  ...base.config.publication,
                  state: 'ACTIVE',
                  revisionId: 'published-preview',
                  sourceDraftVersion: base.config.draftVersion,
                  activeRevisionId: 'published-preview',
                },
              },
      },
    };
  }
  if (!['/api/admin/billing', '/api/admin/readiness'].includes(path)) return;
  if (example === 'denied' || example === 'expired' || example === 'error')
    return {
      status: example === 'denied' ? 403 : example === 'expired' ? 401 : 503,
      body: { code: example === 'denied' ? 'FORBIDDEN' : example === 'expired' ? 'UNAUTHORIZED' : 'UNAVAILABLE' },
    };
  if (path === '/api/admin/readiness' && example === 'product-missing')
    return { status: 403, body: { code: 'FORBIDDEN' } };
  if (path === '/api/admin/readiness')
    return {
      status: 200,
      body: {
        version: 'm5-admin-technical-readiness-v1',
        canRead: example !== 'no-access',
        canEdit: !['no-access', 'view-only'].includes(example),
      },
    };
  if (path === '/api/admin/billing') {
    const billing: BillingView = {
      status:
        example === 'trial' || example === 'development'
          ? 'trial'
          : example === 'inactive'
            ? 'inactive'
            : example === 'unverified'
              ? 'unavailable'
              : 'active',
      observedAt: '2026-10-25T10:30:00Z',
      trialEndsAt: ['trial', 'development'].includes(example) ? '2026-11-08T10:30:00Z' : null,
      currentCycle: ['trial', 'development', 'inactive', 'unverified'].includes(example)
        ? null
        : { startTime: '2026-10-15T10:30:00Z', endTime: '2026-11-14T10:30:00Z' },
      scheduledCancellation: example === 'cancelling',
      pendingChange: example === 'pending',
      newActionsAllowed: !['inactive', 'unverified'].includes(example),
      standardPrice: { amount: '49.99', currency: 'USD', intervalDays: 30 },
      recurringPrice: ['inactive', 'unverified'].includes(example)
        ? null
        : { amount: example === 'development' ? '0.00' : '49.99', currency: 'USD' },
      recurringDiscount:
        example === 'discounted'
          ? { amount: '5.00', percentage: null, remainingCycles: 2, endsAt: '2026-12-14T10:30:00Z' }
          : null,
      developmentTerms: example === 'development',
      managementUrl: '/__preview/settings/billing-handoff',
    };
    return { status: 200, body: billing };
  }
  return;
}
