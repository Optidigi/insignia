import {
  MerchantDraftSchema,
  placementProductSchema,
  variantPhotoSetupSchema,
  type PlacementProduct,
} from '@insignia/contracts';
import { validateGeometry, type GeometryV1 } from '@insignia/visualizer/geometry';
import type { ConfigView } from '../shared/admin-view.ts';
import { legacyVariantPhotos } from './legacy-variant-photos.ts';

export class UnsupportedHistoricalPricingError extends Error {}

const featuredOrVariantPhoto = /^(?:product|variant)_[1-9][0-9]{0,19}$/;

/**
 * Shopify lists a featured or variant photo (`product_<id>`, `variant_<id>`) and the same photo as product media
 * (`image_<id>`) at one URL. Show each photo once under its stable media identity and move saved appearance
 * references to it; the catalogue keeps every identity, so earlier drafts and published setups still resolve.
 * An identity the saved geometry already uses wins, so a save keeps recognising its prior image (retained
 * production dimensions depend on that identity).
 */
function eachPhotoOnce(product: PlacementProduct, referenced: ReadonlySet<string>): PlacementProduct {
  const rank = (id: string) => (referenced.has(id) ? 2 : featuredOrVariantPhoto.test(id) ? 0 : 1);
  const owner = new Map<string, string>();
  for (const { id, url } of product.images) {
    const current = owner.get(url);
    if (!id.startsWith('upload_') && (!current || rank(id) > rank(current))) owner.set(url, id);
  }
  const moved = new Map<string, string>();
  const images = product.images.filter(({ id, url }) => {
    const keep = owner.get(url);
    // Distinct media identities are never merged; only a featured/variant alias and the media entry for one photo.
    if (!keep || keep === id || !(featuredOrVariantPhoto.test(id) || featuredOrVariantPhoto.test(keep))) return true;
    moved.set(id, keep);
    return false;
  });
  if (!moved.size) return product;
  const { variantPhotos } = product;
  return {
    ...product,
    images,
    ...(variantPhotos
      ? {
          variantPhotos: {
            ...variantPhotos,
            assignments: variantPhotos.assignments.map((assignment) =>
              assignment.imageId && moved.has(assignment.imageId)
                ? { ...assignment, imageId: moved.get(assignment.imageId) }
                : assignment,
            ),
          },
        }
      : {}),
  };
}

/** Project real persisted authoring state. Legacy copied values remain product-owned, never inferred inherited. */
export function selectedProductFromConfig(view: ConfigView): PlacementProduct {
  return eachPhotoOnce(projectConfig(view), geometryPhotos(view));
}

function geometryPhotos(view: ConfigView): ReadonlySet<string> {
  if (!view.config) return new Set();
  try {
    const geometry = validateGeometry(MerchantDraftSchema.parse(view.config.draft).geometry as GeometryV1);
    return new Set(
      geometry.views.flatMap((item) => [
        ...(item.image ? [item.image.revisionId] : []),
        ...item.variantImages.map((variant) => variant.image.revisionId),
      ]),
    );
  } catch {
    return new Set();
  }
}

function projectConfig(view: ConfigView): PlacementProduct {
  const catalog = view.product;
  const images = catalog.images ?? [];
  if (!view.config)
    return placementProductSchema.parse({
      id: catalog.id,
      title: catalog.title,
      images,
      methods: [],
      views: [],
      ...variantPhotos(catalog),
    });
  const draft = MerchantDraftSchema.parse(view.config.draft);
  const retainedChoices = draft.productionOptions.length
    ? {
        productionChoices: {
          definitions: structuredClone(draft.productionOptions),
          labels: {
            ...(draft.labels?.options ? { options: structuredClone(draft.labels.options) } : {}),
            ...(draft.labels?.values ? { values: structuredClone(draft.labels.values) } : {}),
          },
        },
      }
    : {};
  if (draft.selectedSetup) {
    const saved = draft.selectedSetup.product;
    const { variantPhotos: _priorVariantPhotos, ...independentSaved } = saved;
    if (saved.variantPhotos && (catalog.variantsTruncated || !catalog.options))
      throw new Error('Complete current variant metadata required');
    const actual = variantPhotos(catalog).variantPhotos;
    const groupingOptionIds =
      saved.variantPhotos?.groupingOptionIds.filter((id) => actual?.options.some((option) => option.id === id)) ?? [];
    const retained =
      actual && saved.variantPhotos
        ? saved.variantPhotos.assignments.filter(
            (assignment) =>
              variantPhotoSetupSchema.safeParse({ ...actual, groupingOptionIds, assignments: [assignment] }).success,
          )
        : [];
    const appearancesRemoved =
      !!saved.variantPhotos &&
      (retained.length !== saved.variantPhotos.assignments.length ||
        groupingOptionIds.length !== saved.variantPhotos.groupingOptionIds.length);
    const media = new Map(saved.images.map((image) => [image.id, image]));
    for (const image of images) media.set(image.id, image);
    const oldByUrl = new Map(saved.images.map((image) => [image.url, image.id]));
    return placementProductSchema.parse({
      ...independentSaved,
      ...retainedChoices,
      ...(actual ? { variantPhotos: { ...actual, groupingOptionIds, assignments: retained } } : {}),
      id: catalog.id,
      title: catalog.title,
      images: [...media.values()],
      views: saved.views.map((item) => {
        const fresh = media.get(oldByUrl.get(item.imageUrl) ?? '');
        const reviewed = appearancesRemoved ? { ...item, needsAlignmentReview: true } : item;
        return fresh
          ? {
              ...reviewed,
              imageUrl: fresh.url,
              imageWidth: fresh.width,
              imageHeight: fresh.height,
              ...(fresh.id.startsWith('upload_') && item.calibration
                ? { calibration: { ...item.calibration, imageUrl: fresh.url } }
                : {}),
              ...(!fresh.id.startsWith('upload_') && item.imageUrl !== fresh.url ? { needsAlignmentReview: true } : {}),
            }
          : reviewed;
      }),
    });
  }
  const geometry = validateGeometry(draft.geometry as GeometryV1);
  const untouchedScaffold =
    !draft.methods.length &&
    !draft.placements.length &&
    !draft.productionOptions.length &&
    !draft.pricingRules.length &&
    !draft.labels &&
    geometry.views.length === 1 &&
    geometry.views[0]?.id === 'front' &&
    !geometry.views[0].image &&
    !geometry.views[0].variantImages.length &&
    !geometry.views[0].placements.length &&
    !geometry.steps.length;
  if (untouchedScaffold)
    return placementProductSchema.parse({
      id: catalog.id,
      title: catalog.title,
      images,
      methods: [],
      views: [],
      ...variantPhotos(catalog),
    });
  const priceScopes = new Set<string>();
  if (
    draft.pricingRules.some((rule) => {
      if (
        rule.role !== 'unit' ||
        rule.scope.kind !== 'step' ||
        !rule.scope.methodId ||
        rule.methodUnitMultiplicity !== undefined ||
        rule.rate.kind !== 'fixed' ||
        rule.rate.amount.presentmentOverrides.length ||
        rule.rate.amount.shopDecimal.startsWith('-')
      )
        return true;
      const key = JSON.stringify([rule.scope.placementId, rule.scope.stepId, rule.scope.methodId]);
      if (priceScopes.has(key)) return true;
      priceScopes.add(key);
      return false;
    })
  )
    throw new UnsupportedHistoricalPricingError(
      'Review unsupported historical pricing before adopting the selected editor',
    );
  const methods = draft.methods.map((method) => ({
    id: method.id,
    name: draft.labels?.methods?.[method.id] ?? method.id,
    pricing: 'product' as const,
    amount: '',
  }));
  const views = geometry.views.map((item) => {
    const image = item.image ? images.find((candidate) => candidate.id === item.image?.revisionId) : undefined;
    return {
      id: item.id,
      name: draft.labels?.views?.[item.id] ?? item.id,
      imageUrl: image?.url ?? '',
      imageWidth: item.image?.width ?? 1,
      imageHeight: item.image?.height ?? 1,
      ...(item.image && !image ? { needsAlignmentReview: true } : {}),
      placements: item.placements.map((area) => {
        const placement = draft.placements.find((candidate) => candidate.id === area.id);
        if (!placement) throw new Error('Published placement references changed');
        const sizes = placement.allowedStepIds.map((id) => {
          const step = geometry.steps.find((candidate) => candidate.id === id);
          if (!step) throw new Error('Decoration size references changed');
          const prices: Record<string, string> = {};
          for (const methodId of placement.allowedMethodIds) {
            const rule = draft.pricingRules.find(
              (candidate) =>
                candidate.scope.kind === 'step' &&
                candidate.scope.placementId === placement.id &&
                candidate.scope.stepId === id &&
                candidate.scope.methodId === methodId,
            );
            if (rule?.rate.kind === 'fixed') prices[methodId] = rule.rate.amount.shopDecimal;
          }
          return {
            id,
            name: draft.labels?.steps?.[id] ?? id,
            widthPercent: String(step.widthFraction * 100),
            ...(step.heightFraction !== step.widthFraction || step.widthFraction < 0.01
              ? { heightPercent: String(step.heightFraction * 100) }
              : {}),
            prices,
          };
        });
        const largest = placement.allowedStepIds
          .map((id) => geometry.steps.find((step) => step.id === id))
          .find((step) => step?.physicalMm);
        return {
          id: area.id,
          name: draft.labels?.placements?.[area.id] ?? area.id,
          rect: area.rect,
          widthCm: largest?.physicalMm ? String(largest.physicalMm.width / (10 * largest.widthFraction)) : '',
          heightCm: largest?.physicalMm ? String(largest.physicalMm.height / (10 * largest.heightFraction)) : '',
          methodIds: placement.allowedMethodIds,
          sizes,
          logoLaterAllowed: placement.logoLaterAllowed,
          customPlacementAllowed: false,
        };
      }),
    };
  });
  return placementProductSchema.parse({
    ...retainedChoices,
    id: catalog.id,
    title: catalog.title,
    images,
    methods,
    views,
    ...(geometry.views.some(
      (view) => view.variantImages.length || view.placements.some((area) => area.variantOverrides?.length),
    )
      ? { variantPhotos: legacyVariantPhotos({ geometry, catalog, views, images }) }
      : variantPhotos(catalog)),
  });
}

function variantPhotos(catalog: ConfigView['product']) {
  if (!catalog.options?.length || catalog.variantsTruncated) return {};
  const options = catalog.options.map((option) => ({
    id: option.id,
    name: option.name,
    values: option.values.map((label) => ({ id: label, label })),
  }));
  const variants = catalog.variants.map((variant) => ({
    id: variant.id,
    label: variant.title,
    optionValues: Object.fromEntries(
      options.map((option) => [
        option.id,
        variant.selectedOptions.find((choice) => choice.name === option.name)?.value ?? '',
      ]),
    ),
  }));
  return { variantPhotos: { options, variants, groupingOptionIds: [], assignments: [] } };
}
