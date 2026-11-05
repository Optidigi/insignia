/** Tab-local draft bridge used only by the loopback admin preview. */

import type { ProductConfigurationSummary } from '../../../src/shared/admin-view.js';
import { isVariantPhotoExample, variantPhotoExamples } from './placement-variant-photo-examples.mts';
import { type PlacementProduct, placementProductSchema } from './placement-workflow-model.mts';

export const SETUP_EXAMPLE_STORAGE_KEY = 'insignia-placement-example';
const placementDraftPrefix = 'insignia-placement-preview-v2:';
const maximumDraftCharacters = 8 * 1024 * 1024;

export const placementSetupExamples = [
  'configured',
  'partial',
  'large',
  'many-methods',
  'blank',
  'no-images',
  'first-product',
  'copy-ready',
  ...variantPhotoExamples,
] as const;
export type PlacementSetupExample = (typeof placementSetupExamples)[number];
export type PlacementPreviewStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type PlacementPreviewState = {
  version: 1;
  draft: PlacementProduct;
  published: PlacementProduct | null;
  revision: number;
};

type StoredPlacementPreview =
  | { kind: 'missing' }
  | { kind: 'valid'; state: PlacementPreviewState }
  | { kind: 'malformed' }
  | { kind: 'unavailable' };

export type PlacementPreviewStorageRead =
  | { status: 'missing' }
  | { status: 'valid'; state: PlacementPreviewState }
  | { status: 'malformed' }
  | { status: 'unavailable' };

const knownProductIds = new Set([
  'gid://shopify/Product/15468416336256',
  'gid://shopify/Product/15468473450880',
  'gid://shopify/Product/15464675246464',
]);
const unconfiguredExamples = new Set<PlacementSetupExample>(['blank', 'no-images', 'first-product']);

function sessionStorageOrNull(): PlacementPreviewStorage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** Resolve the tab-local storage port once when several reads and one write form a workflow. */
export function resolvePlacementPreviewStorage(storage = sessionStorageOrNull()): PlacementPreviewStorage | null {
  return storage;
}

function isPlacementSetupExample(value: string | null): value is PlacementSetupExample {
  return value !== null && (placementSetupExamples as readonly string[]).includes(value);
}

export function readPlacementSetupExample(storage = sessionStorageOrNull()): PlacementSetupExample {
  const requested = globalThis.location
    ? new URLSearchParams(globalThis.location.search).get('__variant_example')
    : null;
  if (isVariantPhotoExample(requested)) return requested;
  try {
    const value = storage?.getItem(SETUP_EXAMPLE_STORAGE_KEY) ?? null;
    return isPlacementSetupExample(value) ? value : 'configured';
  } catch {
    return 'configured';
  }
}

export function placementPreviewStorageKey(example: PlacementSetupExample, productId: string): string {
  return `${placementDraftPrefix}${example}:${productId}`;
}

export function readPlacementPreviewProduct(
  example: PlacementSetupExample,
  productId: string,
  storage = sessionStorageOrNull(),
): PlacementProduct | null {
  return readPlacementPreviewState(example, productId, storage)?.draft ?? null;
}

function stateFromSerializedProduct(serialized: string, productId: string): PlacementPreviewState | null {
  if (serialized.length > maximumDraftCharacters) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return null;
  }

  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const envelope = parsed as Record<string, unknown>;
    if ('version' in envelope || 'draft' in envelope || 'published' in envelope || 'revision' in envelope) {
      if (Object.keys(envelope).some((key) => !['version', 'draft', 'published', 'revision'].includes(key)))
        return null;
      if (envelope.version !== 1 || !Number.isSafeInteger(envelope.revision) || (envelope.revision as number) < 0)
        return null;
      const draft = placementProductSchema.safeParse(envelope.draft);
      const published = envelope.published === null ? null : placementProductSchema.safeParse(envelope.published);
      if (!draft.success || (published !== null && !published.success)) return null;
      if (draft.data.id !== productId || (published && published.data.id !== productId)) return null;
      return {
        version: 1,
        draft: draft.data,
        published: published?.data ?? null,
        revision: envelope.revision as number,
      };
    }
  }

  const legacy = placementProductSchema.safeParse(parsed);
  return legacy.success && legacy.data.id === productId
    ? { version: 1, draft: legacy.data, published: null, revision: 0 }
    : null;
}

function readStoredPlacementPreview(
  example: PlacementSetupExample,
  productId: string,
  storage: PlacementPreviewStorage | null | undefined,
): StoredPlacementPreview {
  if (!storage) return { kind: 'unavailable' };
  try {
    const serialized = storage.getItem(placementPreviewStorageKey(example, productId));
    if (serialized === null) return { kind: 'missing' };
    const state = stateFromSerializedProduct(serialized, productId);
    return state ? { kind: 'valid', state } : { kind: 'malformed' };
  } catch {
    return { kind: 'unavailable' };
  }
}

/** Distinguish an absent record from malformed data so writes can fail closed. */
export function inspectPlacementPreviewState(
  example: PlacementSetupExample,
  productId: string,
  storage = sessionStorageOrNull(),
): PlacementPreviewStorageRead {
  if (!knownProductIds.has(productId)) return { status: 'unavailable' };
  const stored = readStoredPlacementPreview(example, productId, storage);
  if (stored.kind === 'valid') return { status: 'valid', state: stored.state };
  if (stored.kind === 'missing') return { status: 'missing' };
  return { status: stored.kind };
}

/** Read a tab-local publication envelope, or adapt a legacy raw product as a draft-only state. */
export function readPlacementPreviewState(
  example: PlacementSetupExample,
  productId: string,
  storage = sessionStorageOrNull(),
): PlacementPreviewState | null {
  if (!knownProductIds.has(productId)) return null;
  const stored = inspectPlacementPreviewState(example, productId, storage);
  return stored.status === 'valid' ? stored.state : null;
}

/** Atomically replace the current key with one well-formed state envelope. */
function persistPlacementPreviewState(
  example: PlacementSetupExample,
  state: PlacementPreviewState,
  storage = sessionStorageOrNull(),
): boolean {
  if (!storage || !knownProductIds.has(state.draft.id)) return false;
  try {
    if (state.version !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0) return false;
    const draft = placementProductSchema.safeParse(state.draft);
    const published = state.published === null ? null : placementProductSchema.safeParse(state.published);
    if (!draft.success || (published !== null && !published.success)) return false;
    if (draft.data.id !== state.draft.id || (published && published.data.id !== state.draft.id)) return false;
    const serialized = JSON.stringify({
      version: 1,
      draft: draft.data,
      published: published?.data ?? null,
      revision: state.revision,
    } satisfies PlacementPreviewState);
    if (serialized.length > maximumDraftCharacters) return false;
    storage.setItem(placementPreviewStorageKey(example, state.draft.id), serialized);
    return true;
  } catch {
    return false;
  }
}

/** Atomically replace the current key with one well-formed state envelope, refusing malformed prior data. */
export function writePlacementPreviewState(
  example: PlacementSetupExample,
  state: PlacementPreviewState,
  storage = sessionStorageOrNull(),
): boolean {
  if (!storage || !knownProductIds.has(state.draft.id)) return false;
  const existing = inspectPlacementPreviewState(example, state.draft.id, storage);
  if (existing.status === 'malformed' || existing.status === 'unavailable') return false;
  return persistPlacementPreviewState(example, state, storage);
}

export function writePlacementPreviewProduct(
  example: PlacementSetupExample,
  product: PlacementProduct,
  storage = sessionStorageOrNull(),
): boolean {
  if (!knownProductIds.has(product.id) || !storage) return false;
  const productResult = placementProductSchema.safeParse(product);
  if (!productResult.success) return false;
  const existing = inspectPlacementPreviewState(example, product.id, storage);
  if (existing.status === 'malformed' || existing.status === 'unavailable') return false;
  return persistPlacementPreviewState(
    example,
    {
      version: 1,
      draft: productResult.data,
      published: existing.status === 'valid' ? existing.state.published : null,
      revision: existing.status === 'valid' ? existing.state.revision : 0,
    },
    storage,
  );
}

export function placementProductSummary(product: PlacementProduct): ProductConfigurationSummary {
  const methodsById = new Map<string, string>();
  for (const method of product.methods) {
    if (!methodsById.has(method.id)) methodsById.set(method.id, method.name);
  }
  const assignedMethodIds = new Set<string>();
  const methods: string[] = [];
  const locationPlacementIds = new Set<string>();
  const locations: string[] = [];

  for (const view of product.views) {
    for (const placement of view.placements) {
      if (!locationPlacementIds.has(placement.id)) {
        locationPlacementIds.add(placement.id);
        locations.push(placement.name);
      }
      for (const methodId of placement.methodIds) {
        if (assignedMethodIds.has(methodId)) continue;
        assignedMethodIds.add(methodId);
        const name = methodsById.get(methodId)?.trim();
        if (name) methods.push(name);
      }
    }
  }

  return { state: 'draft', methods, locations };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Keep the API fixture intact except for locally saved or deliberately empty preview summaries. */
export function overlayPlacementProductSummaries(
  payload: unknown,
  example: PlacementSetupExample,
  storage = sessionStorageOrNull(),
): unknown {
  const response = record(payload);
  if (!response || !Array.isArray(response.products)) return payload;

  let changed = false;
  const products = response.products.map((entry: unknown) => {
    const product = record(entry);
    const productId = product?.id;
    if (!product || typeof productId !== 'string' || !knownProductIds.has(productId)) return entry;

    const saved = readPlacementPreviewState(example, productId, storage);
    if (saved) {
      changed = true;
      const effective = saved.published ?? saved.draft;
      const summary = placementProductSummary(effective);
      return {
        ...product,
        configurationSummary: saved.published ? { ...summary, state: 'published' } : summary,
      };
    }
    if (
      !unconfiguredExamples.has(example) &&
      !(example === 'copy-ready' && productId !== 'gid://shopify/Product/15468416336256')
    )
      return entry;
    changed = true;
    return {
      ...product,
      configurationSummary: { state: 'not_configured', methods: [], locations: [] },
    };
  });

  return changed ? { ...response, products } : payload;
}
