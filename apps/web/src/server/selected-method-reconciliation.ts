import {
  MerchantDraftSchema,
  type MethodConfiguration,
  type MethodDraftBinding,
  methodAssignedToProduct,
  methodAssignmentReviewKey,
  type SelectedProductSetup,
  type VersionedMethodConfiguration,
} from '@insignia/contracts';
import { type DurableCore, type DurableTransaction, sha256CanonicalJson } from '@insignia/database';
import { reconcileMethodBinding } from '@insignia/domain';
import { selectedProductDraft } from './selected-product.ts';

export type MethodProductTags = Record<string, string[]>;
const numericProductId = (value: string) => value.replace(/^gid:\/\/shopify\/Product\//, '');
const cellKey = (placementId: string, sizeId: string) => JSON.stringify([placementId, sizeId]);

/** Apply catalogue changes only where explicit bindings prove inheritance. */
export function reconcileSelectedMethodSetup(
  source: SelectedProductSetup,
  methodId: string,
  current: VersionedMethodConfiguration | null,
  assigned: boolean,
  shopCurrency: string,
): SelectedProductSetup {
  const bindings: Record<string, MethodDraftBinding> = { ...source.methodBindings };
  const product = {
    ...source.product,
    methods: [...source.product.methods],
    views: source.product.views.map((view) => ({
      ...view,
      placements: view.placements.map((placement) => ({
        ...placement,
        sizes: placement.sizes.map((size) => ({ ...size, prices: { ...size.prices } })),
      })),
    })),
  };
  for (const [localId, previous] of Object.entries(bindings)) {
    if (previous.catalogMethodId !== methodId) continue;
    const assignmentKey = methodAssignmentReviewKey(current?.configuration ?? null, assigned);
    const priceCurrencyMatches =
      current === null ||
      current.currency === shopCurrency ||
      (current.currency === undefined && current.configuration.pricing === 'product');
    const binding = reconcileMethodBinding(previous, current, assigned, assignmentKey, priceCurrencyMatches);
    bindings[localId] = binding;
    const index = product.methods.findIndex((method) => method.id === localId);
    const method = product.methods[index];
    if (!method) throw new Error('Method binding references a missing selected method');
    const cells = product.views.flatMap((view) =>
      view.placements
        .filter((placement) => placement.methodIds.includes(localId))
        .flatMap((placement) =>
          placement.sizes.map((size) => ({ placement, size, field: binding.prices[cellKey(placement.id, size.id)] })),
        ),
    );
    const explicitDefault = binding.prices.default?.source === 'product' ? binding.prices.default.value : null;
    const explicitPrice = cells.some((cell) => cell.field?.source === 'product');
    const retainPriceMode = !current || previous.review?.reason === 'deleted' || !priceCurrencyMatches;
    const pricing = retainPriceMode
      ? method.pricing
      : explicitDefault !== null && method.pricing === 'fixed'
        ? 'fixed'
        : current.configuration.pricing === 'fixed' && !explicitPrice
          ? 'fixed'
          : 'product';
    const amount =
      pricing === 'fixed'
        ? (explicitDefault ??
          binding.prices.default?.value ??
          (priceCurrencyMatches ? current?.configuration.amount : undefined) ??
          method.amount)
        : '';
    product.methods[index] = {
      ...method,
      name: binding.name.value,
      explanation: binding.explanation.value,
      translations: Object.fromEntries(
        Object.entries(binding.translations).map(([locale, fields]) => [
          locale,
          {
            ...(fields.name ? { name: fields.name.value } : {}),
            ...(fields.explanation ? { explanation: fields.explanation.value } : {}),
          },
        ]),
      ),
      pricing,
      amount,
    };
    for (const { size, field } of cells) if (field) size.prices[localId] = field.value;
  }
  return { ...source, product, methodBindings: bindings };
}

/** Caller already holds the current tenant authorization lock; each affected draft is CAS-updated. */
export async function reconcileSelectedMethodDrafts(input: {
  core: DurableCore;
  transaction: DurableTransaction;
  shopId: string;
  methodId: string;
  current: VersionedMethodConfiguration | null;
  productTags: MethodProductTags;
}) {
  const records = await input.core.configs.listSelectedForMethod(input.transaction, input.shopId, input.methodId, true);
  for (const record of records) {
    const draft = MerchantDraftSchema.parse(record.draftValue);
    if (!draft.selectedSetup) continue;
    const method: MethodConfiguration | null = input.current?.configuration ?? null;
    const tags = input.productTags[numericProductId(record.externalProductId)];
    if (method?.assignment === 'tags' && tags === undefined)
      throw new Error('Current product assignment tags unavailable');
    const assigned =
      method !== null && methodAssignedToProduct(method, { id: record.externalProductId, tags: tags ?? [] });
    const setup = reconcileSelectedMethodSetup(
      draft.selectedSetup,
      input.methodId,
      input.current,
      assigned,
      draft.shopCurrency,
    );
    if (JSON.stringify(setup) === JSON.stringify(draft.selectedSetup)) continue;
    const updated = await input.core.configs.updateDraft(input.transaction, {
      shopId: input.shopId,
      configId: record.configId,
      expectedVersion: record.draftVersion,
      schemaVersion: record.draftSchemaVersion,
      draftValue: selectedProductDraft(setup, draft),
    });
    if (updated.kind !== 'updated') throw new Error('Method propagation conflicted with a product draft');
  }
}

/** A retained snapshot cannot silently become an unbound legacy copy. */
export class SelectedMethodBindingContinuityError extends Error {
  constructor() {
    super('Configured Method inheritance metadata changed. Reload and review the draft.');
  }
}
class SelectedMethodReviewRequiredError extends Error {}

/** Normalize newly imported bindings against the current catalogue inside the draft command transaction. */
export async function reconcileIncomingSelectedSetup(
  core: DurableCore,
  transaction: DurableTransaction,
  actor: { tenantShopId: string },
  source: SelectedProductSetup,
  shopCurrency: string,
  authoritativeTags?: readonly string[],
  previous?: SelectedProductSetup,
): Promise<SelectedProductSetup> {
  const retained = new Set(source.product.methods.map((method) => method.id));
  for (const [localId, binding] of Object.entries(previous?.methodBindings ?? {})) {
    if (!retained.has(localId)) continue; // Removing the snapshot is an explicit remove decision.
    const incoming = source.methodBindings[localId];
    if (!incoming || incoming.catalogMethodId !== binding.catalogMethodId)
      throw new SelectedMethodBindingContinuityError();
  }
  const catalog = new Map(
    (await core.methodCatalog.listConfigurations(transaction, actor.tenantShopId)).map((method) => [
      method.configuration.id,
      method,
    ]),
  );
  let setup = source;
  for (const [localId, binding] of Object.entries(source.methodBindings)) {
    if (
      binding.review?.reason === 'deleted' &&
      catalog.has(binding.catalogMethodId) &&
      previous?.methodBindings[localId]?.review?.reason !== 'deleted'
    )
      throw new SelectedMethodBindingContinuityError();
  }
  for (const methodId of new Set(Object.values(source.methodBindings).map((binding) => binding.catalogMethodId))) {
    const current = catalog.get(methodId) ?? null;
    if (current?.configuration.assignment === 'tags' && authoritativeTags === undefined)
      throw new SelectedMethodReviewRequiredError('Current product assignment tags unavailable');
    const bindings = Object.values(source.methodBindings).filter((binding) => binding.catalogMethodId === methodId);
    if (
      current?.configuration.pricing === 'fixed' &&
      current.currency !== shopCurrency &&
      bindings.some((binding) => Object.values(binding.prices).some((field) => field.source === 'catalog'))
    )
      throw new SelectedMethodReviewRequiredError('Review Method prices in the current shop currency before saving.');
    const assigned =
      current !== null &&
      methodAssignedToProduct(current.configuration, { id: source.product.id, tags: authoritativeTags ?? [] });
    setup = reconcileSelectedMethodSetup(setup, methodId, current, assigned, shopCurrency);
  }
  return setup;
}

/** New publication must use current inherited facts, without changing its frozen candidate. */
export async function selectedMethodPublicationIsCurrent(
  core: DurableCore,
  transaction: DurableTransaction,
  actor: { tenantShopId: string },
  source: SelectedProductSetup,
  shopCurrency: string,
  authoritativeTags?: readonly string[],
): Promise<boolean> {
  const configured = new Set(
    source.product.views.flatMap((view) => view.placements.flatMap((placement) => placement.methodIds)),
  );
  const bindings = Object.entries(source.methodBindings).filter(([id]) => configured.has(id));
  if (!bindings.length) return true;
  const candidate = { ...source, methodBindings: Object.fromEntries(bindings) };
  try {
    const reconciled = await reconcileIncomingSelectedSetup(
      core,
      transaction,
      actor,
      candidate,
      shopCurrency,
      authoritativeTags,
      candidate,
    );
    return sha256CanonicalJson(candidate) === sha256CanonicalJson(reconciled);
  } catch (error) {
    if (error instanceof SelectedMethodReviewRequiredError || error instanceof SelectedMethodBindingContinuityError)
      return false;
    throw error;
  }
}
