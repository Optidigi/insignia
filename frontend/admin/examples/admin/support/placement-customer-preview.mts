import { parsePrice } from './method-workflow-prices.mts';
import { getVariantPhotoGroups, resolveVariantPhotoView } from './placement-variant-photos.mts';
import { type PlacementProduct, placementProductSchema, placementSetupIssue } from './placement-workflow-model.mts';

const customerPreviewOrigin = 'http://127.0.0.1:5173';
const handshakeTimeoutMs = 10_000;

export type CustomerPreviewFailure =
  | 'appearance-unavailable'
  | 'assigned-images-required'
  | 'draft-invalid'
  | 'product-name-required'
  | 'view-required'
  | 'product-image-required'
  | 'images-for-placement-views-required'
  | 'view-name-required'
  | 'priced-placement-required'
  | 'placement-limit-exceeded'
  | 'snapshot-copy-failed'
  | 'draft-load-failed'
  | 'preview-open-failed'
  | 'preview-send-failed';
export type CustomerPreviewReadiness = { ready: true } | { ready: false; reason: CustomerPreviewFailure };

export class CustomerPreviewError extends Error {
  readonly reason: CustomerPreviewFailure;

  constructor(reason: CustomerPreviewFailure) {
    super(reason);
    this.reason = reason;
  }
}

export interface CustomerPreviewOptions {
  appearanceGroupKey?: string;
}

/** Artwork geometry and images only. Variant catalogue data is not a buyer configuration. */
export type ArtworkPreviewProduct = Omit<PlacementProduct, 'variantPhotos'>;

export function buildArtworkPreviewSnapshot(
  input: PlacementProduct,
  options: CustomerPreviewOptions = {},
): ArtworkPreviewProduct {
  const product = placementProductSchema.parse(structuredClone(input));
  if (
    options.appearanceGroupKey &&
    !getVariantPhotoGroups(product).some((group) => group.key === options.appearanceGroupKey)
  ) {
    throw new CustomerPreviewError('appearance-unavailable');
  }
  const views = options.appearanceGroupKey
    ? product.views.map((view) => resolveVariantPhotoView(product, view.id, options.appearanceGroupKey).view)
    : product.views;
  if (
    product.variantPhotos?.groupingOptionIds.length &&
    views.some((view) => view.placements.length && !view.imageUrl)
  ) {
    throw new CustomerPreviewError('assigned-images-required');
  }
  // Without an active choice, these are the explicitly configured shared view images.
  // Never select a variant assignment by its ordering, title or image shape.
  return { id: product.id, title: product.title, images: product.images, views, methods: product.methods };
}

type CustomerPreviewSource = PlacementProduct | (() => PlacementProduct | Promise<PlacementProduct>);

function placementReadyForCustomerPreview(
  product: PlacementProduct,
  placement: PlacementProduct['views'][number]['placements'][number],
): boolean {
  if (placementSetupIssue(product, placement)) return false;
  const hasNamedPricedMethod = product.methods.some((method) => {
    if (!placement.methodIds.includes(method.id) || !method.name.trim()) return false;
    return method.pricing === 'fixed'
      ? parsePrice(method.amount).kind === 'valid'
      : placement.sizes.some((size) => parsePrice(size.prices[method.id] ?? '').kind === 'valid');
  });
  if (!hasNamedPricedMethod) return false;
  const factors = placement.sizes.map((size) => Number(size.widthPercent));
  const names = placement.sizes.map((size) => size.name.trim().toLowerCase());
  return (
    placement.sizes.every((size) => size.name.trim().length > 0) &&
    new Set(names).size === names.length &&
    factors.every((factor) => Number.isFinite(factor) && factor > 0 && factor <= 100) &&
    new Set(factors).size === factors.length
  );
}

export function customerPreviewReadiness(
  input: PlacementProduct,
  options: CustomerPreviewOptions = {},
): CustomerPreviewReadiness {
  let product: ArtworkPreviewProduct;
  try {
    product = buildArtworkPreviewSnapshot(input, options);
  } catch (error) {
    return { ready: false, reason: error instanceof CustomerPreviewError ? error.reason : 'draft-invalid' };
  }
  if (!product.title.trim()) return { ready: false, reason: 'product-name-required' };
  if (!product.views.length) return { ready: false, reason: 'view-required' };
  if (!product.views.some((view) => view.imageUrl)) {
    return { ready: false, reason: 'product-image-required' };
  }
  if (product.views.some((view) => view.placements.length > 0 && !view.imageUrl)) {
    return { ready: false, reason: 'images-for-placement-views-required' };
  }
  if (product.views.some((view) => view.imageUrl && !view.name.trim())) {
    return { ready: false, reason: 'view-name-required' };
  }
  const readyPlacements = product.views.reduce(
    (count, view) =>
      count +
      (view.imageUrl
        ? view.placements.filter((placement) => placementReadyForCustomerPreview(product, placement)).length
        : 0),
    0,
  );
  if (readyPlacements === 0) {
    return {
      ready: false,
      reason: 'priced-placement-required',
    };
  }
  if (readyPlacements > 100) {
    return { ready: false, reason: 'placement-limit-exceeded' };
  }
  return { ready: true };
}

function nonce(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const values = new Uint8Array(24);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('');
}

function report(onError: (reason: CustomerPreviewFailure) => void, reason: CustomerPreviewFailure): void {
  try {
    onError(reason);
  } catch {
    // A notification callback must not keep the preview listener alive.
  }
}

/** Open the existing customer designer with a one-use, validated draft snapshot. */
export function launchCustomerPreview(
  source: CustomerPreviewSource,
  onError: (reason: CustomerPreviewFailure) => void,
  options: CustomerPreviewOptions = {},
): void {
  let copiedProduct: ArtworkPreviewProduct | null = null;
  if (typeof source !== 'function') {
    const readiness = customerPreviewReadiness(source, options);
    if (!readiness.ready) {
      report(onError, readiness.reason);
      return;
    }
    try {
      copiedProduct = buildArtworkPreviewSnapshot(source, options);
    } catch {
      report(onError, 'snapshot-copy-failed');
      return;
    }
  }

  const id = nonce();
  const prototypeOrigin = new URL(customerPreviewOrigin).origin;
  const url = new URL('/', customerPreviewOrigin);
  url.searchParams.set('adminPreview', id);
  url.searchParams.set('adminOrigin', window.location.origin);

  let child: Window | null = null;
  let receivedReady = false;
  let finished = false;
  let timeout: number | undefined;

  function cleanup(): void {
    window.removeEventListener('message', onMessage);
    if (timeout !== undefined) window.clearTimeout(timeout);
  }

  function fail(reason: CustomerPreviewFailure): void {
    if (finished) return;
    finished = true;
    cleanup();
    if (child && !child.closed) child.close();
    report(onError, reason);
  }

  function sendIfReady(): void {
    if (finished || !receivedReady || !copiedProduct || !child) return;
    try {
      child.postMessage({ type: 'insignia:customer-preview:data', nonce: id, product: copiedProduct }, prototypeOrigin);
      finished = true;
      cleanup();
    } catch {
      fail('preview-send-failed');
    }
  }

  function onMessage(event: MessageEvent<unknown>): void {
    if (!child || event.source !== child || event.origin !== prototypeOrigin) return;
    if (
      !event.data ||
      typeof event.data !== 'object' ||
      !('type' in event.data) ||
      !('nonce' in event.data) ||
      event.data.type !== 'insignia:customer-preview:ready' ||
      event.data.nonce !== id
    )
      return;
    receivedReady = true;
    sendIfReady();
  }

  window.addEventListener('message', onMessage);
  child = window.open(url.toString(), '_blank');
  if (!child) {
    fail('preview-open-failed');
    return;
  }
  timeout = window.setTimeout(() => {
    fail('preview-open-failed');
  }, handshakeTimeoutMs);

  function acceptProduct(product: PlacementProduct): void {
    const readiness = customerPreviewReadiness(product, options);
    if (!readiness.ready) {
      fail(readiness.reason);
      return;
    }
    try {
      copiedProduct = buildArtworkPreviewSnapshot(product, options);
      sendIfReady();
    } catch {
      fail('snapshot-copy-failed');
    }
  }

  if (typeof source === 'function') {
    try {
      void Promise.resolve(source())
        .then(acceptProduct)
        .catch(() => {
          fail('draft-load-failed');
        });
    } catch {
      fail('draft-load-failed');
    }
  } else {
    sendIfReady();
  }
}
