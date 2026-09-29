import { type PublishedConfig, validatePublishedConfig } from '../config/model.js';

export const CUSTOMIZATION_GROUP_VERSION = 'm2-customization-group-v1' as const;
export const DESIGN_IDENTITY_VERSION = 'm2-design-identity-v1' as const;

export type ArtworkChoice = { kind: 'revision'; revisionId: string } | { kind: 'deferred'; intentId: string };

export interface ProductionDesign {
  placements: { placementId: string; methodId: string; stepId: string; artwork: ArtworkChoice }[];
  options: { optionId: string; valueId: string }[];
}

export interface CustomizationGroup {
  version: typeof CUSTOMIZATION_GROUP_VERSION;
  productId: string;
  configRevisionId: string;
  revisionContentHash: string;
  design: ProductionDesign;
  variants: { variantId: string; quantity: number }[];
}

export interface NormalizedCustomizationGroup extends CustomizationGroup {
  canonicalIdentity: string;
}

function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function requireId(value: string, label: string): void {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))
    throw new Error(`invalid ${label}`);
}

function uniqueBy<T>(items: T[], key: (item: T) => string, label: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    const id = key(item);
    requireId(id, label);
    if (seen.has(id)) throw new Error(`duplicate ${label}: ${id}`);
    seen.add(id);
  }
}

// This structured canonical value is the identity contract; hashing it is optional.
// Arrays are sorted by stable IDs and fields are emitted in one explicit order.
export function canonicalDesignIdentity(group: CustomizationGroup): string {
  if (!group || group.version !== CUSTOMIZATION_GROUP_VERSION)
    throw new Error('unsupported customization group version');
  requireId(group.productId, 'product ID');
  requireId(group.configRevisionId, 'revision ID');
  if (typeof group.revisionContentHash !== 'string' || !/^[a-f0-9]{64}$/.test(group.revisionContentHash))
    throw new Error('invalid group revision content hash');
  if (!group.design || !Array.isArray(group.design.placements) || !Array.isArray(group.design.options))
    throw new Error('invalid production design');
  uniqueBy(group.design.placements, (item) => item.placementId, 'selected placement ID');
  uniqueBy(group.design.options, (item) => item.optionId, 'selected option ID');
  if (group.design.placements.length === 0) throw new Error('production design has no placements');
  const placements = group.design.placements
    .map((item) => {
      requireId(item.methodId, 'selected method ID');
      requireId(item.stepId, 'selected step ID');
      if (!item.artwork || (item.artwork.kind !== 'revision' && item.artwork.kind !== 'deferred'))
        throw new Error('invalid artwork choice');
      const artworkId = item.artwork.kind === 'revision' ? item.artwork.revisionId : item.artwork.intentId;
      requireId(artworkId, 'artwork revision or deferred intent ID');
      return [item.placementId, item.methodId, item.stepId, item.artwork.kind, artworkId] as const;
    })
    .sort((left, right) => compareId(left[0], right[0]));
  const options = group.design.options
    .map((item) => {
      requireId(item.valueId, 'selected option value ID');
      return [item.optionId, item.valueId] as const;
    })
    .sort((left, right) => compareId(left[0], right[0]));
  return JSON.stringify([
    DESIGN_IDENTITY_VERSION,
    group.productId,
    group.configRevisionId,
    group.revisionContentHash,
    placements,
    options,
  ]);
}

export const canonicalCustomizationKey = canonicalDesignIdentity;

function validateSelection(group: CustomizationGroup, config: PublishedConfig): void {
  const placements = new Map(config.placements.map((item) => [item.id, item]));
  const options = new Map(config.productionOptions.map((item) => [item.id, item]));
  for (const selection of group.design.placements) {
    const placement = placements.get(selection.placementId);
    if (
      !placement?.allowedMethodIds.includes(selection.methodId) ||
      !placement?.allowedStepIds.includes(selection.stepId)
    ) {
      throw new Error('invalid selected placement/method/step reference');
    }
    if (selection.artwork.kind === 'deferred' && !placement.logoLaterAllowed)
      throw new Error('logo-later is not allowed at placement');
  }
  for (const selection of group.design.options) {
    const option = options.get(selection.optionId);
    if (!option?.allowedValueIds.includes(selection.valueId)) throw new Error('invalid production option reference');
  }
}

export function normalizeCustomizationGroups(
  groups: CustomizationGroup[],
  configs: PublishedConfig[],
): NormalizedCustomizationGroup[] {
  if (!Array.isArray(groups) || !Array.isArray(configs)) throw new Error('invalid group/config inputs');
  const configByKey = new Map<string, PublishedConfig>();
  for (const config of configs) {
    const checked = validatePublishedConfig(config);
    const key = JSON.stringify([checked.productId, checked.revisionId]);
    if (configByKey.has(key)) throw new Error('duplicate published config identity');
    configByKey.set(key, checked);
  }
  const byIdentity = new Map<string, NormalizedCustomizationGroup>();
  for (const group of groups) {
    const canonicalIdentity = canonicalDesignIdentity(group);
    const config = configByKey.get(JSON.stringify([group.productId, group.configRevisionId]));
    if (!config) throw new Error('missing published config for group');
    if (group.revisionContentHash !== config.revisionContentHash)
      throw new Error('published revision content hash mismatch');
    validateSelection(group, config);
    if (!Array.isArray(group.variants) || group.variants.length === 0) throw new Error('empty variant quantity vector');
    const existing = byIdentity.get(canonicalIdentity);
    const variants = new Map((existing?.variants ?? []).map((variant) => [variant.variantId, variant.quantity]));
    for (const variant of group.variants) {
      requireId(variant.variantId, 'variant ID');
      if (!Number.isSafeInteger(variant.quantity) || variant.quantity <= 0)
        throw new Error('invalid physical quantity');
      const total = (variants.get(variant.variantId) ?? 0) + variant.quantity;
      if (!Number.isSafeInteger(total)) throw new Error('physical quantity overflow');
      variants.set(variant.variantId, total);
    }
    const normalizedVariants = [...variants]
      .sort(([left], [right]) => compareId(left, right))
      .map(([variantId, quantity]) => ({ variantId, quantity }));
    const groupQuantity = normalizedVariants.reduce((total, variant) => total + variant.quantity, 0);
    if (!Number.isSafeInteger(groupQuantity)) throw new Error('group physical quantity overflow');
    const normalizedDesign: ProductionDesign = {
      placements: [...group.design.placements]
        .sort((left, right) => compareId(left.placementId, right.placementId))
        .map((selection) => ({
          placementId: selection.placementId,
          methodId: selection.methodId,
          stepId: selection.stepId,
          artwork: { ...selection.artwork },
        })),
      options: [...group.design.options]
        .sort((left, right) => compareId(left.optionId, right.optionId))
        .map((selection) => ({ ...selection })),
    };
    byIdentity.set(canonicalIdentity, {
      version: CUSTOMIZATION_GROUP_VERSION,
      productId: group.productId,
      configRevisionId: group.configRevisionId,
      revisionContentHash: group.revisionContentHash,
      design: existing?.design ?? normalizedDesign,
      variants: normalizedVariants,
      canonicalIdentity,
    });
  }
  return [...byIdentity.values()].sort((left, right) => compareId(left.canonicalIdentity, right.canonicalIdentity));
}
