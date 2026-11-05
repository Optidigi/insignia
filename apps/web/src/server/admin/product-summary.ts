import { MerchantDraftSchema } from '@insignia/contracts';
import { parseMinor } from '@insignia/domain';
import type { CatalogProduct } from './contracts.js';

type SummaryRecord = { draft: unknown; published: boolean };
export function productSummary(product: CatalogProduct, record?: SummaryRecord): CatalogProduct {
  if (!record)
    return {
      ...product,
      configurationSummary: { state: 'not_configured', methods: [], locations: [] },
      methodSetup: [],
    };
  const result = MerchantDraftSchema.safeParse(record.draft);
  if (!result.success) return product; // Unavailable is distinct from an empty configuration.
  const draft = result.data;
  const selected = draft.selectedSetup?.product;
  const placements = selected?.views.flatMap((view) => view.placements);
  const methods =
    selected?.methods ??
    draft.methods.map((method) => ({
      id: method.id,
      name: draft.labels?.methods?.[method.id] ?? method.id,
      pricing: 'product',
      amount: '',
    }));
  const used = new Set(
    placements
      ? placements.flatMap((placement) => placement.methodIds)
      : draft.placements.flatMap((placement) => placement.allowedMethodIds),
  );
  const priced = (value: string) => {
    try {
      parseMinor(value, 2);
      return true;
    } catch {
      return false;
    }
  };
  const methodSetup = methods
    .filter((method) => used.has(method.id))
    .map((method) => {
      const configured = placements?.filter((placement) => placement.methodIds.includes(method.id));
      return {
        methodId: method.id,
        locations:
          configured?.length ??
          draft.placements.filter((placement) => placement.allowedMethodIds.includes(method.id)).length,
        pricedLocations:
          configured?.filter((placement) =>
            placement.sizes.some((size) =>
              priced(method.pricing === 'fixed' ? method.amount : (size.prices[method.id] ?? '')),
            ),
          ).length ??
          draft.placements.filter(
            (placement) =>
              placement.allowedMethodIds.includes(method.id) &&
              draft.pricingRules.some(
                (rule) =>
                  rule.scope.kind === 'step' &&
                  rule.scope.placementId === placement.id &&
                  rule.scope.methodId === method.id &&
                  rule.rate.kind === 'fixed' &&
                  priced(rule.rate.amount.shopDecimal),
              ),
          ).length,
      };
    });
  return {
    ...product,
    configurationSummary: {
      state: record.published ? 'published' : 'draft',
      methods: methods.filter((method) => used.has(method.id)).map((method) => method.name),
      locations:
        placements?.map((placement) => placement.name) ??
        draft.placements.map((placement) => draft.labels?.placements?.[placement.id] ?? placement.id),
    },
    methodSetup,
  };
}
