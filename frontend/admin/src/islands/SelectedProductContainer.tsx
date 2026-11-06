import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  AdminConfigViewSchema,
  MerchantDraftSchema,
  MerchantPreferencesViewSchema,
  MethodCatalogViewSchema,
  type PlacementProduct,
  type VersionedMethodConfiguration,
} from '@insignia/contracts';
import { calibratedDimensions } from '@insignia/visualizer/geometry';
import { withAdminLocale, useAdminLocale } from '../shared/admin-i18n';
import { useAdminPageReady } from '../shared/admin-page-ready';
import { authenticatedJson } from '../shared/admin-request';
import type { ConfigView } from '../shared/admin-view';
import { launchCustomerPreview } from '../../examples/admin/support/placement-customer-preview.mts';
import type { PlacementPublicationIssue } from './selected-product-publication';
import { PlacementEditor, type ProductEditorAdapter, type ProductPublicationResult } from './SelectedProductEditor';
import { createSelectedProductClient, SelectedProductReviewChanged } from './selected-product-client';
import { selectedProductFromConfig, UnsupportedHistoricalPricingError } from './selected-product-view';
import { LegacyVariantPhotoError } from './legacy-variant-photos';
import {
  applyMethodImport,
  currentProductMethodReviews,
  bindNewProductCells,
  overrideProductPrice,
  reviewProductMethod,
  type ProductMethodBindings,
} from './selected-product-bindings';
import { createSelectedProductCopyPorts } from './selected-product-copy';
import { createSelectedProductMedia } from './selected-product-media';
import {
  isMerchantPublicationContinuing,
  isMerchantPublicationOperatorBlocked,
} from './merchant-config-editor-workflow';

type Client = ReturnType<typeof createSelectedProductClient>;
type Media = ReturnType<typeof createSelectedProductMedia>;
function SelectedProductContainer({ productId }: { productId: string }) {
  const { t } = useAdminLocale();
  const [initial, setInitial] = useState<PlacementProduct | null>(null);
  const [view, setView] = useState<ConfigView | null>(null);
  const [failed, setFailed] = useState(false);
  const [historicalReview, setHistoricalReview] = useState<'pricing' | 'appearance' | null>(null);
  const [remote, setRemote] = useState<'idle' | 'pending' | 'failed' | 'conflict'>('idle');
  const [settled, setSettled] = useState<PlacementProduct | undefined>();
  const [adopted, setAdopted] = useState(false);
  const [, renderMetadata] = useState(0);
  const client = useRef<Client | null>(null);
  const media = useRef<Media | null>(null);
  const bindings = useRef<ProductMethodBindings>({});
  const currentProduct = useRef<PlacementProduct | null>(null);
  const records = useRef<VersionedMethodConfiguration[]>([]);
  const currency = useRef<string | null>(null);
  const canEdit = useRef(false);
  const selectionScope = useRef('');
  const requestVersion = useRef(0);
  const activity = useRef(0);
  const copyPorts = useMemo(() => {
    try {
      return typeof window === 'undefined'
        ? null
        : createSelectedProductCopyPorts({ storage: sessionStorage, request: authorizedRequest });
    } catch {
      return null;
    }
  }, [productId]);
  useAdminPageReady(initial !== null || failed);
  useEffect(() => {
    void load();
    return () => {
      requestVersion.current++;
      client.current?.dispose();
      media.current?.dispose();
    };
  }, [productId]);
  useEffect(() => {
    let running = false;
    async function inspect() {
      const owned = client.current;
      if (!owned || running) return;
      running = true;
      const version = requestVersion.current,
        started = activity.current;
      try {
        const fresh = await owned.peek();
        if (
          version !== requestVersion.current ||
          started !== activity.current ||
          owned.isBusy() ||
          owned.isUnverified()
        )
          return;
        if (!owned.adoptObservation(fresh)) {
          setRemote('conflict');
          return;
        }
        // Publication/readiness metadata can advance without replacing the local authoring draft or CAS base.
        setView((previous) =>
          previous?.config && fresh.config
            ? {
                ...previous,
                product: fresh.product,
                config: {
                  ...previous.config,
                  publication: fresh.config.publication,
                  publishedSetup: fresh.config.publishedSetup,
                  publishEligibility: fresh.config.publishEligibility,
                  currentShopCurrency: fresh.config.currentShopCurrency,
                },
              }
            : previous,
        );
        const reviewed = currentProductMethodReviews(bindings.current, records.current, fresh.product);
        if (reviewed !== bindings.current) updateBindings(reviewed);
        if (!owned.hasPending())
          setRemote((previous) =>
            previous === 'pending' ? (fresh.config?.publication.state === 'FAILED' ? 'failed' : 'idle') : previous,
          );
      } catch {
        /* The request boundary removes private state on authorization loss. Transient reads preserve edits. */
      } finally {
        running = false;
      }
    }
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void inspect();
    }, 5000);
    window.addEventListener('focus', inspect);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', inspect);
    };
  }, [productId]);
  function denied() {
    requestVersion.current++;
    activity.current++;
    client.current?.dispose();
    client.current = null;
    media.current?.dispose();
    media.current = null;
    bindings.current = {};
    records.current = [];
    currentProduct.current = null;
    canEdit.current = false;
    setInitial(null);
    setSettled(undefined);
    setView(null);
    setFailed(true);
    setRemote('failed');
  }
  async function authorizedRequest(path: string, init?: RequestInit): Promise<unknown> {
    const version = requestVersion.current;
    try {
      const value = await authenticatedJson<unknown>(path, init);
      if (version !== requestVersion.current) throw new DOMException('Product context changed', 'AbortError');
      return value;
    } catch (error) {
      if (
        version === requestVersion.current &&
        error &&
        typeof error === 'object' &&
        'status' in error &&
        (error.status === 401 || error.status === 403)
      ) {
        client.current?.dispose(true);
        denied();
      }
      throw error;
    }
  }
  function updateBindings(next: ProductMethodBindings) {
    bindings.current = next;
    renderMetadata((value) => value + 1);
  }
  async function hydrate(value: ConfigView, target: Media = media.current!) {
    const product = selectedProductFromConfig(value);
    await target.hydrate(product.images);
    return target.display(product);
  }
  async function observe(value: ConfigView) {
    const version = requestVersion.current;
    if (!media.current) throw new Error('Product context unavailable');
    const product = await hydrate(value);
    if (version !== requestVersion.current) throw new Error('Product context changed');
    const parsedDraft = MerchantDraftSchema.safeParse(value.config?.draft);
    bindings.current = parsedDraft.success ? (parsedDraft.data.selectedSetup?.methodBindings ?? {}) : {};
    currentProduct.current = product;
    setView(value);
    setSettled(product);
    renderMetadata((count) => count + 1);
    return product;
  }
  async function load() {
    const version = ++requestVersion.current;
    activity.current++;
    client.current?.dispose();
    setFailed(false);
    setHistoricalReview(null);
    let ownedMedia: Media | null = null;
    try {
      if (!copyPorts) throw new Error('Pending write custody unavailable');
      const observed: { current: ReturnType<typeof MerchantPreferencesViewSchema.parse> | null } = { current: null };
      const ownedClient = createSelectedProductClient({
        productId,
        storage: sessionStorage,
        onDenied: () => {
          if (version === requestVersion.current) denied();
        },
        request: async (path, init) => {
          const value = await authenticatedJson<unknown>(path, init);
          if (path === '/api/admin/preferences') observed.current = MerchantPreferencesViewSchema.parse(value);
          return value;
        },
      });
      const value = await ownedClient.load();
      if (version !== requestVersion.current) return;
      const prefs = observed.current;
      if (!prefs) throw new Error('Product authority unavailable');
      const catalogue = MethodCatalogViewSchema.parse(await authenticatedJson('/api/admin/methods?view=catalog'));
      if (version !== requestVersion.current) return;
      if (!catalogue.currency || !['USD', 'EUR'].includes(catalogue.currency))
        throw new Error('Shop currency unavailable');
      if (catalogue.shop !== prefs.shop || catalogue.authority !== prefs.authority)
        throw new Error('Product authority changed while loading');
      if (value.config?.currentShopCurrency && value.config.currentShopCurrency !== catalogue.currency)
        throw new Error('Shop currency changed while loading');
      ownedMedia = createSelectedProductMedia(productId, prefs.authority, { request: authorizedRequest });
      const product = await hydrate(value, ownedMedia);
      if (version !== requestVersion.current) {
        ownedMedia.dispose();
        return;
      }
      media.current?.dispose();
      media.current = ownedMedia;
      ownedMedia = null;
      client.current = ownedClient;
      canEdit.current = prefs.canEdit === true;
      selectionScope.current = `${prefs.shop}:${prefs.authority}`;
      currency.current = catalogue.currency;
      records.current = catalogue.methods;
      const parsedDraft = MerchantDraftSchema.safeParse(value.config?.draft);
      bindings.current = currentProductMethodReviews(
        parsedDraft.success ? (parsedDraft.data.selectedSetup?.methodBindings ?? {}) : {},
        catalogue.methods,
        value.product,
      );
      currentProduct.current = product;
      setView(value);
      setInitial(product);
      setSettled(undefined);
      setAdopted(false);
      setRemote(ownedClient.hasPending() ? 'pending' : 'idle');
    } catch (error) {
      if (version === requestVersion.current) {
        setHistoricalReview(
          error instanceof UnsupportedHistoricalPricingError
            ? 'pricing'
            : error instanceof LegacyVariantPhotoError
              ? 'appearance'
              : null,
        );
        setFailed(true);
      }
    } finally {
      ownedMedia?.dispose();
    }
  }
  const publication = useMemo(() => {
    if (!view || !initial) return null;
    const revision = Number(view.config?.draftVersion ?? '0');
    if (!Number.isSafeInteger(revision)) return null;
    return {
      version: 1 as const,
      draft: settled ?? initial,
      published: view.config?.publishedSetup ? media.current!.display(view.config.publishedSetup.product) : null,
      revision,
    };
  }, [view, initial, settled]);
  const storedCurrency = view?.config ? MerchantDraftSchema.parse(view.config.draft).shopCurrency : currency.current;
  const currencyReview = !!view?.config && storedCurrency !== currency.current && !adopted;
  const usedMethods = new Set(
    currentProduct.current?.views.flatMap((entry) => entry.placements.flatMap((placement) => placement.methodIds)) ??
      [],
  );
  const reviews = Object.entries(bindings.current)
    .filter(([id, binding]) => usedMethods.has(id) && binding.review?.decision === 'pending')
    .map(([id]) => ({
      methodId: id,
      name: currentProduct.current?.methods.find((method) => method.id === id)?.name ?? id,
    }));
  async function retry() {
    if (!client.current) return;
    const owned = client.current;
    activity.current++;
    try {
      setRemote('pending');
      const value = await owned.retry();
      await observe(value);
      setRemote(owned.hasPending() ? 'pending' : value.config?.publication.state === 'FAILED' ? 'failed' : 'idle');
    } catch {
      if (client.current === owned) setRemote(owned.hasPending() ? 'pending' : 'failed');
    }
  }
  const adapter: ProductEditorAdapter | null =
    initial && view && copyPorts
      ? {
          kind: 'production',
          currency: adopted ? currency.current! : storedCurrency!,
          selectionScope: selectionScope.current,
          publication,
          settled,
          copyPorts,
          readOnly: !canEdit.current || currencyReview,
          hasPublished: !!view.config?.publication.activeRevisionId,
          publicationFailed: view.config?.publication.state === 'FAILED' && !client.current?.hasPending(),
          publicationBlocked:
            remote === 'conflict' ||
            remote === 'failed' ||
            (!!view.config &&
              (isMerchantPublicationOperatorBlocked(view.config.publication.state) ||
                isMerchantPublicationContinuing(view.config.publication.state))),
          revision: () => {
            const value = Number(view.config?.draftVersion ?? '0');
            if (!Number.isSafeInteger(value)) throw new Error('Unsupported draft version');
            return value;
          },
          pending: () => client.current?.hasPending() ?? false,
          getBindings: () => bindings.current,
          restoreBindings: updateBindings,
          productChanging: (_previous, next) => {
            activity.current++;
            const projected = bindNewProductCells(next, bindings.current);
            bindings.current = projected.bindings;
            currentProduct.current = projected.product;
            return projected.product;
          },
          reviews,
          reviewMethod: (product, id, decision) => {
            const reviewed = reviewProductMethod(product, bindings.current, id, decision);
            updateBindings(reviewed.bindings);
            return reviewed.product;
          },
          saveIssues: (product) => {
            const sizes = product.views.reduce(
              (count, row) => count + row.placements.reduce((sum, placement) => sum + placement.sizes.length, 0),
              0,
            );
            return product.views.length > 16 || sizes > 64 ? [{ key: 'capacity', reason: 'capacity-exceeded' }] : [];
          },
          publicationIssues: (product) => {
            const issues: PlacementPublicationIssue[] = [];
            const count = product.views.reduce((sum, row) => sum + row.placements.length, 0);
            const sizes = product.views.reduce(
              (sum, row) => sum + row.placements.reduce((n, placement) => n + placement.sizes.length, 0),
              0,
            );
            const methods = new Set(
              product.views.flatMap((row) => row.placements.flatMap((placement) => placement.methodIds)),
            );
            if (
              product.views.length > 16 ||
              count > 32 ||
              sizes > 64 ||
              methods.size > 32 ||
              (product.variantPhotos?.variants.length ?? 0) > 250
            )
              issues.push({ key: 'capacity', reason: 'capacity-exceeded' });
            for (const row of reviews)
              issues.push({ key: `methods.${row.methodId}.review`, reason: 'method-review-required' });
            for (const entry of product.views)
              if (
                entry.placements.length &&
                (!entry.calibration || !calibratedDimensions(entry.calibration, entry.placements[0]!.rect))
              )
                issues.push({
                  key: `views.${entry.id}.calibration`,
                  viewId: entry.id,
                  reason: 'production-dimensions-required',
                });
            return issues;
          },
          async loadMethods(signal) {
            const version = requestVersion.current;
            const [catalogue, freshValue] = await Promise.all([
              authorizedRequest('/api/admin/methods?view=catalog', { signal }),
              authorizedRequest(`/api/admin/products/${productId.split('/').at(-1)}/config`, { signal }),
            ]);
            if (version !== requestVersion.current) throw new Error('Product context changed');
            const fresh = AdminConfigViewSchema.parse(freshValue);
            const parsed = MethodCatalogViewSchema.parse(catalogue);
            records.current = parsed.methods;
            if (parsed.currency !== currency.current) throw new Error('Review changed shop currency');
            if (
              parsed.methods.some((entry) => entry.configuration.assignment === 'tags') &&
              fresh.product.tags === undefined
            )
              throw new Error('Product tags unavailable');
            return {
              methods: parsed.methods
                .filter((entry) => entry.configuration.pricing !== 'fixed' || entry.currency === adapter!.currency)
                .map((entry) => entry.configuration),
              products: [
                {
                  id: fresh.product.id,
                  title: fresh.product.title,
                  image: fresh.product.imageUrl ?? '',
                  tags: fresh.product.tags ?? [],
                  collections: fresh.product.collections ?? [],
                  setup: fresh.product.methodSetup ?? [],
                },
              ],
            };
          },
          methodsApplied(placementId, change, choices, editedIds, editedCells) {
            const next = applyMethodImport({
              bindings: bindings.current,
              product: currentProduct.current!,
              placementId,
              change,
              choices,
              editedIds,
              editedCells,
              catalog: records.current,
              currency: adapter!.currency,
            });
            updateBindings(next);
          },
          priceEdited: (placementId, sizeId, methodId, amount) =>
            updateBindings(overrideProductPrice(bindings.current, placementId, sizeId, methodId, amount)),
          upload: async (image) => media.current!.upload(image),
          preview: launchCustomerPreview,
          async save(product) {
            const owned = client.current!;
            activity.current++;
            try {
              const value = await owned.save({
                version: 'selected-product-setup-v1',
                product: media.current!.canonical(product),
                methodBindings: bindings.current,
              });
              const confirmed = await observe(value);
              setRemote('idle');
              return confirmed;
            } catch (error) {
              if (client.current === owned) setRemote(owned.hasPending() ? 'pending' : 'conflict');
              throw error;
            }
          },
          async publish(product): Promise<ProductPublicationResult> {
            const owned = client.current!;
            activity.current++;
            try {
              const value = await owned.publish({
                version: 'selected-product-setup-v1',
                product: media.current!.canonical(product),
                methodBindings: bindings.current,
              });
              const confirmed = await observe(value);
              if (value.config?.publication.state === 'FAILED' && !owned.hasPending()) {
                setRemote('failed');
                return { status: 'rejected' };
              }
              if (value.config?.publication.state !== 'ACTIVE' || owned.hasPending()) {
                setRemote('pending');
                return { status: 'pending' };
              }
              setRemote('idle');
              return {
                status: 'published',
                state: {
                  version: 1,
                  draft: confirmed,
                  published: confirmed,
                  revision: Number(value.config.draftVersion),
                },
              };
            } catch (error) {
              if (error instanceof SelectedProductReviewChanged) {
                const product = await observe(error.view);
                setRemote('conflict');
                return { status: 'changed', product };
              }
              if (client.current === owned) setRemote(owned.hasPending() ? 'pending' : 'failed');
              throw error;
            }
          },
        }
      : null;
  if (failed && !initial)
    return (
      <s-page heading={t('editor:placementWorkflowPreview.productCouldNotBeLoaded')}>
        <s-banner tone="critical">
          {t(
            historicalReview === 'pricing'
              ? 'editor:placementWorkflowPreview.realHistoricalPricingReview'
              : historicalReview === 'appearance'
                ? 'editor:placementWorkflowPreview.realHistoricalAppearanceReview'
                : 'editor:placementWorkflowPreview.tryReloadingPage',
          )}
        </s-banner>
        <s-button onClick={() => void load()}>{t('common:actions.retry')}</s-button>
      </s-page>
    );
  if (!initial || !adapter || !view) return null;
  return (
    <>
      {currencyReview && (
        <s-banner tone="warning">
          {t('editor:placementWorkflowPreview.realCurrencyReview', { currency: currency.current! })}
          <s-button
            onClick={() => {
              client.current!.adoptCurrency(currency.current!);
              const next = structuredClone(bindings.current);
              for (const binding of Object.values(next))
                for (const price of Object.values(binding.prices)) price.source = 'product';
              updateBindings(next);
              setAdopted(true);
            }}
          >
            {t('editor:placementWorkflowPreview.realReviewCurrency')}
          </s-button>
        </s-banner>
      )}
      {(remote !== 'idle' ||
        (!!view.config && isMerchantPublicationOperatorBlocked(view.config.publication.state))) && (
        <s-banner tone={remote === 'pending' ? 'warning' : 'critical'}>
          {t(
            view.config && isMerchantPublicationOperatorBlocked(view.config.publication.state)
              ? 'editor:placementWorkflowPreview.realPublicationBlocked'
              : view.config?.publication.state === 'FAILED' && !client.current?.hasPending()
                ? 'editor:placementWorkflowPreview.realPublicationFailed'
                : 'editor:placementWorkflowPreview.realSaveFailed',
          )}
          {(view.config?.publication.reason || view.config?.publishEligibility.reason) && (
            <s-paragraph>{view.config.publication.reason ?? view.config.publishEligibility.reason}</s-paragraph>
          )}
          {client.current?.hasPending() && (
            <s-button onClick={() => void retry()}>{t('common:actions.retry')}</s-button>
          )}
          {!client.current?.hasPending() && (
            <s-button onClick={() => location.reload()}>
              {t('editor:placementWorkflowPreview.realReloadDraft')}
            </s-button>
          )}
        </s-banner>
      )}
      <PlacementEditor initial={initial} adapter={adapter} />
    </>
  );
}
export default withAdminLocale(SelectedProductContainer);
