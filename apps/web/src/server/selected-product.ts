import {
  getVariantPhotoGroups,
  type MerchantDraft,
  MerchantDraftSchema,
  readSelectedStepIdentity,
  resolveVariantPhotoView,
  type SelectedProductSetup,
  SelectedProductSetupSchema,
  selectedPriceIdentity,
  selectedStepIdentity,
} from '@insignia/contracts';
import { parseMinor } from '@insignia/domain';
import {
  calibratedDimensions,
  GEOMETRY_VERSION,
  type GeometryV1,
  validateGeometry,
  validateGeometryBridge,
} from '@insignia/visualizer/geometry';
import type { CatalogProduct } from '../shared/admin-view.js';

export class SelectedSetupAuthorityError extends Error {}
export class SelectedSetupCapacityError extends Error {}

const validId = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const positive = (value: string) =>
  /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value) && Number.isFinite(Number(value)) && Number(value) > 0;

/** Authoring keeps the selected editor's values; commerce uses only this validated, exact projection. */
export function selectedProductDraft(setupInput: SelectedProductSetup, previous: MerchantDraft): MerchantDraft {
  const setup = SelectedProductSetupSchema.parse(setupInput);
  const product = setup.product;
  let previousGeometry: GeometryV1 | null = null;
  try {
    previousGeometry = validateGeometry(previous.geometry as GeometryV1);
  } catch {
    // An unconfigured prior draft has no qualified physical instructions to retain.
  }
  const steps = product.views.reduce(
    (sum, view) => sum + view.placements.reduce((count, placement) => count + placement.sizes.length, 0),
    0,
  );
  if (product.views.length > 16 || steps > 64)
    throw new SelectedSetupCapacityError(
      'This configuration exceeds the qualified geometry capacity (16 views and 64 sizes).',
    );
  if (new Set(product.images.map((image) => image.id)).size !== product.images.length)
    throw new Error('Repeated product preview media identity');
  const exponent = previous.shopCurrency === 'USD' || previous.shopCurrency === 'EUR' ? 2 : null;
  if (exponent === null) throw new Error('Selected product currency is not qualified');
  // A placement without a method or a size is unfinished authoring work: it stays in selectedSetup
  // and blocks publication readiness, but never enters the commerce projection (#438).
  const projected = (placement: SelectedProductSetup['product']['views'][number]['placements'][number]) =>
    placement.methodIds.length > 0 && placement.sizes.length > 0;
  const usedMethodIds = new Set(
    product.views.flatMap((view) => view.placements.filter(projected).flatMap((placement) => placement.methodIds)),
  );
  const placements: MerchantDraft['placements'] = [];
  const pricingRules: MerchantDraft['pricingRules'] = [];
  const labels: NonNullable<MerchantDraft['labels']> = {
    methods: {},
    placements: {},
    steps: {},
    views: {},
    ...previous.labels,
  };
  labels.methods = {};
  labels.placements = {};
  labels.steps = {};
  labels.views = {};
  if (product.productionChoices) {
    delete labels.options;
    delete labels.values;
    if (product.productionChoices.labels.options)
      labels.options = structuredClone(product.productionChoices.labels.options);
    if (product.productionChoices.labels.values)
      labels.values = structuredClone(product.productionChoices.labels.values);
  }
  const priceLabels: Record<string, string> = {};
  labels.prices = priceLabels;
  const geometry: GeometryV1 = { version: GEOMETRY_VERSION, views: [], steps: [] };
  const identifiers = new Set<string>();
  const claim = (id: string) => {
    if (!validId(id) || identifiers.has(id)) throw new Error('Invalid or repeated selected product identity');
    identifiers.add(id);
  };
  for (const method of product.methods.filter((method) => usedMethodIds.has(method.id))) {
    if (!validId(method.id)) throw new Error('Invalid method identity');
    if (method.name.trim()) labels.methods![method.id] = method.name.trim();
  }
  for (const view of product.views) {
    claim(view.id);
    if (view.name.trim()) labels.views![view.id] = view.name.trim();
    const source = product.images.find((image) => image.url === view.imageUrl);
    if (view.imageUrl && !source) throw new Error('Choose product-owned preview media');
    const mapped: GeometryV1['views'][number] = {
      id: view.id,
      ...(source ? { image: { revisionId: source.id, width: source.width, height: source.height } } : {}),
      variantImages: [],
      placements: [],
    };
    for (const placement of view.placements) {
      claim(placement.id);
      if (!projected(placement)) {
        for (const size of placement.sizes) claim(selectedStepIdentity(placement.id, size.id));
        continue;
      }
      if (placement.name.trim()) labels.placements![placement.id] = placement.name.trim();
      const steps: string[] = [];
      for (const size of placement.sizes) {
        const id = selectedStepIdentity(placement.id, size.id);
        claim(id);
        if (!positive(size.widthPercent) || Number(size.widthPercent) > 100) throw new Error('Invalid decoration size');
        const fraction = Number(size.widthPercent) / 100;
        const heightFraction = Number(size.heightPercent ?? size.widthPercent) / 100;
        if (!positive(size.heightPercent ?? size.widthPercent) || heightFraction > 1)
          throw new Error('Invalid decoration height');
        steps.push(id);
        if (size.name.trim()) labels.steps![id] = size.name.trim();
        const dimensions =
          view.calibration &&
          view.calibration.imageUrl === view.imageUrl &&
          view.calibration.imageWidth === view.imageWidth &&
          view.calibration.imageHeight === view.imageHeight
            ? calibratedDimensions(view.calibration, placement.rect)
            : null;
        const priorView = previousGeometry?.views.find((candidate) => candidate.id === view.id);
        const priorArea = priorView?.placements.find((candidate) => candidate.id === placement.id);
        const allowed = previous.placements.find((candidate) => candidate.id === placement.id)?.allowedStepIds ?? [];
        const priorId =
          !previous.selectedSetup && allowed.includes(size.id)
            ? size.id
            : readSelectedStepIdentity(placement.id, size.id, allowed);
        const priorSize = previousGeometry?.steps.find((candidate) => candidate.id === priorId);
        // Keep actual instructions on unchanged legacy price/text saves. No calibration is inferred from centimetre text.
        const retainedMm =
          !view.calibration &&
          priorArea &&
          priorSize &&
          source &&
          priorView?.image?.revisionId === source.id &&
          priorView.image.width === source.width &&
          priorView.image.height === source.height &&
          view.imageWidth === source.width &&
          view.imageHeight === source.height &&
          (['centerX', 'centerY', 'width', 'height'] as const).every(
            (key) => priorArea.rect[key] === placement.rect[key],
          ) &&
          priorSize.widthFraction === fraction &&
          priorSize.heightFraction === heightFraction
            ? priorSize.physicalMm
            : undefined;
        geometry.steps.push({
          id,
          widthFraction: fraction,
          heightFraction,
          ...(dimensions
            ? {
                physicalMm: {
                  width: Math.round(dimensions.widthCm * 10 * fraction * 1000) / 1000,
                  height: Math.round(dimensions.heightCm * 10 * heightFraction * 1000) / 1000,
                },
              }
            : retainedMm
              ? { physicalMm: { ...retainedMm } }
              : {}),
        });
        for (const methodId of placement.methodIds) {
          const method = product.methods.find((item) => item.id === methodId);
          if (!method) throw new Error('Unknown selected method');
          const amount = method.pricing === 'fixed' ? method.amount : (size.prices[methodId] ?? '');
          if (amount === '') continue; // Missing is unavailable; it never becomes free.
          const decimal = amount.trim().replace(',', '.');
          parseMinor(decimal, exponent);
          const priceId = selectedPriceIdentity(id, methodId);
          const priorRules = previous.pricingRules.filter(
            (rule) =>
              rule.scope.kind === 'step' && rule.scope.placementId === placement.id && rule.scope.methodId === methodId,
          );
          const priorStep = readSelectedStepIdentity(
            placement.id,
            size.id,
            priorRules.flatMap((rule) => (rule.scope.kind === 'step' ? [rule.scope.stepId] : [])),
          );
          const prior = priorRules.find((rule) => rule.scope.kind === 'step' && rule.scope.stepId === priorStep);
          const priorLabel = prior ? previous.labels?.prices?.[prior.id] : undefined;
          if (priorLabel !== undefined) priceLabels[priceId] = priorLabel;
          pricingRules.push({
            id: priceId,
            scope: { kind: 'step', placementId: placement.id, stepId: id, methodId },
            role: 'unit',
            rate: { kind: 'fixed', amount: { shopDecimal: decimal, presentmentOverrides: [] } },
          });
        }
      }
      placements.push({
        id: placement.id,
        allowedMethodIds: placement.methodIds,
        allowedStepIds: steps,
        logoLaterAllowed: placement.logoLaterAllowed,
      });
      mapped.placements.push({ id: placement.id, rect: placement.rect });
    }
    for (const group of getVariantPhotoGroups(product)) {
      const resolved = resolveVariantPhotoView(product, view.id, group.key);
      if (resolved.status !== 'ready') continue; // Incomplete authoring drafts may be saved; publication requires full coverage.
      const assignment = product.variantPhotos!.assignments.find(
        (item) => item.groupKey === group.key && item.viewId === view.id,
      );
      const image = assignment?.imageId ? product.images.find((item) => item.id === assignment.imageId) : source;
      if (!image) throw new Error('Choose product-owned preview media');
      for (const id of group.variantIds) {
        const number = /^gid:\/\/shopify\/ProductVariant\/([1-9][0-9]{0,19})$/.exec(id)?.[1];
        if (!number) throw new Error('Invalid Shopify variant identity');
        const variantId = `variant_${number}`;
        if (image.id !== source?.id)
          mapped.variantImages.push({
            variantId,
            image: { revisionId: image.id, width: image.width, height: image.height },
          });
        for (const area of resolved.view.placements) {
          const shared = mapped.placements.find((item) => item.id === area.id);
          if (!shared) continue; // Unfinished placements have no projected area to override.
          if (
            ['centerX', 'centerY', 'width', 'height'].some(
              (key) => shared.rect[key as keyof typeof shared.rect] !== area.rect[key as keyof typeof area.rect],
            )
          ) {
            shared.variantOverrides ??= [];
            shared.variantOverrides.push({ variantId, rect: area.rect });
          }
        }
      }
    }
    if (
      mapped.variantImages.length > 100 ||
      mapped.placements.some((item) => (item.variantOverrides?.length ?? 0) > 100)
    )
      throw new SelectedSetupCapacityError(
        'This configuration exceeds the qualified appearance capacity (100 image overrides per view and 100 alignment overrides per placement).',
      );
    geometry.views.push(mapped);
  }
  // A newly empty setup is a valid draft, but cannot pass selected publication readiness.
  if (geometry.views.length === 0) geometry.views.push({ id: 'unconfigured', variantImages: [], placements: [] });
  const draft = MerchantDraftSchema.parse({
    ...previous,
    mode: 'required',
    productionOptions: product.productionChoices?.definitions ?? previous.productionOptions,
    methods: product.methods.filter((method) => usedMethodIds.has(method.id)).map(({ id }) => ({ id })),
    placements,
    pricingRules,
    labels,
    geometry,
    selectedSetup: setup,
  });
  validateGeometryBridge(geometry, { version: 'm2-published-config-v1', placements: draft.placements });
  return draft;
}

/** Catalogue is freshly read through the current authenticated merchant actor, never supplied by the browser. */
export function selectedPublicationProblems(draft: MerchantDraft, catalog?: CatalogProduct): string[] {
  const setup = draft.selectedSetup;
  if (!setup) return [];
  const problems: string[] = [];
  const product = setup.product;
  if (catalog) problems.push(...selectedCatalogueProblems(product, catalog));
  if (draft.mode !== 'required') problems.push('Required customization must be enabled.');
  const placementCount = product.views.reduce((count, view) => count + view.placements.length, 0);
  const stepCount = product.views.reduce(
    (count, view) => count + view.placements.reduce((sum, placement) => sum + placement.sizes.length, 0),
    0,
  );
  if (
    placementCount > 32 ||
    draft.methods.length > 32 ||
    stepCount > 64 ||
    (product.variantPhotos?.variants.length ?? 0) > 250
  )
    problems.push(
      'This configuration exceeds the qualified customization capacity (32 placements, 32 methods, 64 sizes, 250 variants).',
    );
  if (!product.views.length) problems.push('Add a product view.');
  if (!product.views.some((view) => view.placements.length > 0)) problems.push('Add an artwork placement.');
  for (const group of getVariantPhotoGroups(product))
    for (const view of product.views) {
      const resolved = resolveVariantPhotoView(product, view.id, group.key);
      if (resolved.status !== 'ready') problems.push(`Add an image for ${group.label} · ${view.name}.`);
      else if (resolved.needsAlignmentReview)
        problems.push(`Review artwork alignment for ${group.label} · ${view.name}.`);
    }
  const configuredMethods = new Set(
    product.views.flatMap((view) => view.placements.flatMap((placement) => placement.methodIds)),
  );
  for (const [localId, binding] of Object.entries(setup.methodBindings))
    if (configuredMethods.has(localId) && binding.review?.decision === 'pending')
      problems.push('Review the unassigned or deleted method before publication.');
  for (const view of product.views) {
    if (!view.imageUrl || !product.images.some((image) => image.url === view.imageUrl))
      problems.push('Choose a product preview image for every view.');
    const source = product.images.find((image) => image.url === view.imageUrl);
    if (source && (view.imageWidth !== source.width || view.imageHeight !== source.height))
      problems.push('Product preview image dimensions changed. Review alignment and calibration.');
    if (view.needsAlignmentReview) problems.push('Review artwork alignment.');
    if (
      view.calibration &&
      (view.calibration.imageUrl !== view.imageUrl ||
        view.calibration.imageWidth !== view.imageWidth ||
        view.calibration.imageHeight !== view.imageHeight)
    )
      problems.push('Calibrate the selected image again.');
    for (const placement of view.placements) {
      if (!view.calibration || !calibratedDimensions(view.calibration, placement.rect))
        problems.push('Calibrate the source image to define production dimensions.');
      if (!placement.methodIds.length || !placement.sizes.length)
        problems.push('Configure methods and decoration sizes.');
      for (const methodId of placement.methodIds) {
        const method = product.methods.find((entry) => entry.id === methodId);
        if (
          !method ||
          !placement.sizes.some(
            (size) => (method.pricing === 'fixed' ? method.amount : (size.prices[methodId] ?? '')) !== '',
          )
        )
          problems.push('Set an available price for every configured method.');
      }
      if (placement.customPlacementAllowed && !placement.movementRect)
        problems.push('Set the permitted artwork movement area.');
    }
  }
  return [...new Set(problems)];
}

function selectedCatalogueProblems(product: SelectedProductSetup['product'], catalog: CatalogProduct): string[] {
  const problems: string[] = [];
  if (catalog.id !== product.id) problems.push('Product identity changed. Reload the editor.');
  if (catalog.variantsTruncated || catalog.variants.length > 250)
    problems.push('The full product variants exceed qualified customization capacity or are unavailable.');
  const photos = product.variantPhotos;
  if (photos) {
    const actualOptions = catalog.options ?? [];
    const optionsMatch =
      photos.options.length === actualOptions.length &&
      photos.options.every((option) => {
        const actual = actualOptions.find((item) => item.id === option.id);
        return (
          actual &&
          actual.name === option.name &&
          actual.values.length === option.values.length &&
          option.values.every((value) => value.id === value.label && actual.values.includes(value.id))
        );
      });
    const variantsMatch =
      photos.variants.length === catalog.variants.length &&
      photos.variants.every((variant) => {
        const actual = catalog.variants.find((item) => item.id === variant.id);
        return (
          actual &&
          /^gid:\/\/shopify\/ProductVariant\/[1-9][0-9]{0,19}$/.test(variant.id) &&
          (variant.label === undefined || variant.label === actual.title) &&
          photos.options.every(
            (option) =>
              actual.selectedOptions.find((item) => item.name === option.name)?.value ===
              variant.optionValues[option.id],
          )
        );
      });
    if (!optionsMatch || !variantsMatch)
      problems.push('Product options or variants changed. Reload and review photo grouping before publication.');
  }
  const used = new Set(
    product.views
      .map((view) => product.images.find((image) => image.url === view.imageUrl)?.id)
      .filter((id): id is string => !!id),
  );
  const activeGroups = new Set(getVariantPhotoGroups(product).map((group) => group.key));
  for (const assignment of product.variantPhotos?.assignments ?? []) {
    if (activeGroups.has(assignment.groupKey) && assignment.imageId) used.add(assignment.imageId);
  }
  for (const id of used) {
    const image = product.images.find((item) => item.id === id);
    if (!image) {
      problems.push('Choose product-owned preview media.');
      continue;
    }
    // Private upload ownership and inspected dimensions are verified by the authenticated immutable capture port.
    if (/^upload_[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(image.id)) continue;
    const actual = catalog.images?.find((item) => item.id === image.id);
    if (!actual || actual.url !== image.url || actual.width !== image.width || actual.height !== image.height)
      problems.push(
        'Product preview media changed or no longer belongs to this product. Reload and review the images.',
      );
  }
  return problems;
}
