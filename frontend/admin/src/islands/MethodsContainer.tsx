import { MethodCatalogViewSchema, type MethodConfiguration } from '@insignia/contracts';
import { useEffect, useRef, useState } from 'preact/hooks';
import { z } from 'zod';
import { type MethodProduct, methodProductSchema } from '../../examples/admin/support/method-configuration.mts';
import { useAdminLocale, withAdminLocale } from '../shared/admin-i18n.js';
import { useAdminPageReady } from '../shared/admin-page-ready.js';
import { authenticatedJson, isShopifyBusy } from '../shared/admin-request.js';
import { createMethodCatalogTransport, methodConfigurationForPicker } from './method-catalog-transport';
import SelectedMethods from './SelectedMethods';

const productSchema = z.object({
  id: z.string().regex(/^gid:\/\/shopify\/Product\/[1-9][0-9]*$/),
  title: z.string(),
  imageUrl: z.string().nullable(),
  tags: z.array(z.string()),
  collections: z.array(z.object({ id: z.string(), title: z.string() })),
  collectionsTruncated: z.boolean(),
  configurationSummary: z.object({ state: z.enum(['not_configured', 'draft', 'published']) }),
  methodSetup: methodProductSchema.shape.setup.optional(),
});
const productPage = z.object({ products: z.array(productSchema), nextCursor: z.string().nullable() });
type Ready = {
  kind: 'ready';
  canEdit: boolean;
  methods: MethodConfiguration[];
  products: MethodProduct[];
  currency: 'USD' | 'EUR';
  methodCurrencies: Record<string, 'USD' | 'EUR'>;
  persist(next: MethodConfiguration[]): Promise<void>;
};

/** Real data/persistence boundary; the selected presentation and reducer are unchanged. */
function MethodsContainer() {
  const { t } = useAdminLocale();
  const [state, setState] = useState<Ready | { kind: 'loading' } | { kind: 'failed'; busy?: true }>({ kind: 'loading' });
  const requestVersion = useRef(0);
  const activeRead = useRef<AbortController | null>(null);
  useAdminPageReady(state.kind !== 'loading');
  useEffect(() => {
    void load();
    return () => {
      requestVersion.current++;
      activeRead.current?.abort();
    };
  }, []);
  async function load() {
    activeRead.current?.abort();
    const controller = new AbortController();
    activeRead.current = controller;
    const version = ++requestVersion.current;
    const current = () => version === requestVersion.current && !controller.signal.aborted;
    async function read(path: string) {
      controller.signal.throwIfAborted();
      const value = await authenticatedJson(path, { signal: controller.signal });
      controller.signal.throwIfAborted();
      if (!current()) throw new DOMException('Method route retired', 'AbortError');
      return value;
    }
    setState({ kind: 'loading' });
    try {
      let catalog = MethodCatalogViewSchema.parse(await read('/api/admin/methods?view=catalog'));
      if (!catalog.shop || !catalog.authority || !catalog.currency || typeof catalog.canEdit !== 'boolean')
        throw new Error('Method authorization context unavailable');
      let transport = createMethodCatalogTransport({
        records: catalog.methods,
        shop: catalog.shop,
        authority: catalog.authority,
        currency: catalog.currency,
        storage: sessionStorage,
      });
      if (catalog.canEdit) await transport.resume();
      // A dispatched write keeps its journal/receipt custody. Route retirement cancels only reads.
      if (!current()) return;
      catalog = MethodCatalogViewSchema.parse(await read('/api/admin/methods?view=catalog'));
      if (!catalog.shop || !catalog.authority || !catalog.currency || typeof catalog.canEdit !== 'boolean')
        throw new Error('Method authorization context unavailable');
      transport = createMethodCatalogTransport({
        records: catalog.methods,
        shop: catalog.shop,
        authority: catalog.authority,
        currency: catalog.currency,
        storage: sessionStorage,
      });
      if (catalog.methods.some((method) => method.configuration.pricing === 'fixed' && method.currency === undefined))
        throw new Error('Saved Method price currency unavailable');
      const methodCurrencies = Object.fromEntries(
        catalog.methods.flatMap((method) => (method.currency ? [[method.configuration.id, method.currency]] : [])),
      );
      const products: MethodProduct[] = [];
      const cursors = new Set<string>();
      const productIds = new Set<string>();
      let cursor: string | null = null;
      do {
        const query = new URLSearchParams();
        if (cursor) query.set('cursor', cursor);
        const page = productPage.parse(await read(`/api/admin/products?${query}`));
        for (const item of page.products) {
          if (productIds.has(item.id)) throw new Error('Product catalogue changed during pagination');
          productIds.add(item.id);
          if (item.collectionsTruncated) throw new Error('Complete product collections unavailable');
          if (item.configurationSummary.state !== 'not_configured' && item.methodSetup === undefined)
            throw new Error('Product method setup unavailable');
          products.push({
            id: item.id,
            title: item.title,
            configurationProductId: item.id.replace('gid://shopify/Product/', ''),
            image: item.imageUrl ?? '',
            tags: item.tags,
            collections: item.collections,
            setup: item.methodSetup ?? [],
          });
        }
        cursor = page.nextCursor;
        if (cursor && (cursors.has(cursor) || products.length >= 10000))
          throw new Error('Complete product catalog unavailable');
        if (cursor) cursors.add(cursor);
      } while (cursor);
      if (!current()) return;
      const canEdit = catalog.canEdit;
      setState({
        kind: 'ready',
        canEdit,
        methods: catalog.methods.map((item) => methodConfigurationForPicker(item.configuration)),
        products,
        currency: catalog.currency,
        methodCurrencies,
        persist: async (next) => {
          try {
            if (!canEdit || version !== requestVersion.current)
              throw Object.assign(new Error('Current edit permission required'), { status: 403 });
            await transport.persist(next);
            if (version !== requestVersion.current) return;
            const methodCurrencies = Object.fromEntries(
              transport
                .currentRecords()
                .flatMap((method) => (method.currency ? [[method.configuration.id, method.currency]] : [])),
            );
            setState((state) => (state.kind === 'ready' ? { ...state, methodCurrencies } : state));
          } catch (error) {
            if (current() && error && typeof error === 'object' && 'status' in error && [401, 403].includes(Number(error.status))) {
              requestVersion.current++;
              setState({ kind: 'failed' });
            }
            throw error;
          }
        },
      });
    } catch (error) {
      // Shopify throttling had no effect; anything else keeps the general failure wording.
      if (current()) setState(isShopifyBusy(error) ? { kind: 'failed', busy: true } : { kind: 'failed' });
    }
  }
  if (state.kind === 'ready')
    return (
      <SelectedMethods
        production
        readOnly={!state.canEdit}
        initial={state.methods}
        products={state.products}
        persist={state.persist}
        translationsEnabled
        currency={state.currency}
        methodCurrencies={state.methodCurrencies}
      />
    );
  if (state.kind === 'loading') return null;
  return (
    <s-page heading={t('methods:workflow.title')}>
      <s-section>
        <s-stack gap="base">
          <s-banner tone="critical">
            {t(state.busy ? 'admin-shell:errors.shopifyBusy' : 'methods:workflow.empty.loadFailure')}
          </s-banner>
          <s-button onClick={() => void load()}>{t('common:actions.retry')}</s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}
export default withAdminLocale(MethodsContainer);
