// design-fees: pure decision logic. Given a draft + cart token, decide which
// (logoContentHash, categoryId, methodId) tuples are first-time-on-cart vs
// already-charged. No DB writes — persistence happens in confirm-charges.

import db from "../../../db.server";
import { designFeesEnabled } from "./feature-flag.server";

export type FeeDecision = {
  categoryId: string;
  categoryName: string;
  methodId: string;
  logoContentHash: string;
  alreadyCharged: boolean;
  feeCentsToCharge: number;
  feeCentsSnapshot: number; // category.feeCents at decision time
  /** placement ids that triggered this category in the current draft */
  placementIds: string[];
};

export type ComputeArgs = {
  shopId: string;
  cartToken: string | null;
  draft: {
    methodId: string;
    placements: Array<{ placementId: string; stepIndex: number }>;
    logoAssetIdsByPlacementId: Record<string, string | null>;
  };
};

/**
 * Synthetic dedup-identity sentinel for "send logo later" mode. The customer
 * has committed to a design (chose method + categorized placement) but hasn't
 * uploaded artwork yet — the merchant still needs to digitize when the logo
 * arrives, so the fee should land. Using a fixed sentinel string lets multiple
 * "later" placements in the same cart with the same category share a single
 * fee (preserves cart-scoped dedup), and downstream code that keys on
 * `logoContentHash` works unchanged.
 */
const PENDING_LOGO_SENTINEL = "pending";

/**
 * Compute which design-fee tuples apply to the current draft, segregated into
 * to-charge and already-charged. Pure read.
 *
 * Returns [] when:
 *  - DESIGN_FEES_ENABLED=false
 *  - cartToken is null/empty (no Shopify cart yet → nothing to dedup against)
 *  - shop has no DesignFeeCategory rows
 *  - no placement is mapped to a category
 *
 * Logo hash handling:
 *  - Real logo with contentHash → uses that hash for dedup.
 *  - "Send later" mode (no logo) OR legacy logo without contentHash → uses
 *    the PENDING_LOGO_SENTINEL above so the fee still lands.
 */
export async function computeFeeDecisionsForDraft(
  args: ComputeArgs,
): Promise<FeeDecision[]> {
  if (!designFeesEnabled()) return [];
  const { shopId, cartToken, draft } = args;
  if (!cartToken) return [];

  // 1) Resolve placements -> categories
  const placementIds = draft.placements.map((p) => p.placementId);
  if (placementIds.length === 0) return [];

  const placements = await db.placementDefinition.findMany({
    where: {
      id: { in: placementIds },
      feeCategoryId: { not: null },
    },
    select: {
      id: true,
      feeCategoryId: true,
    },
  });
  if (placements.length === 0) return [];

  const categoryIds = Array.from(
    new Set(
      placements
        .map((p) => p.feeCategoryId)
        .filter((id): id is string => id !== null),
    ),
  );
  if (categoryIds.length === 0) return [];

  const categories = await db.designFeeCategory.findMany({
    where: { id: { in: categoryIds }, shopId, methodId: draft.methodId },
    select: { id: true, name: true, methodId: true, feeCents: true },
  });
  if (categories.length === 0) return [];
  // Map for quick lookup
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  // 2) Resolve placements -> logo asset -> contentHash. Each placement gets
  //    EITHER a real hash OR the PENDING_LOGO_SENTINEL when no logo is
  //    attached / no hash recorded — so "send later" still triggers fees.
  const logoAssetIds = Array.from(
    new Set(
      Object.values(draft.logoAssetIdsByPlacementId).filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      ),
    ),
  );

  const logoAssets =
    logoAssetIds.length > 0
      ? await db.logoAsset.findMany({
          where: { id: { in: logoAssetIds }, shopId },
          select: { id: true, contentHash: true },
        })
      : [];
  const hashByLogoId = new Map(
    logoAssets
      .filter((l) => l.contentHash)
      .map((l) => [l.id, l.contentHash as string]),
  );

  // 3) Build groups keyed by (logoContentHash, categoryId, methodId)
  type GroupKey = string;
  const groups = new Map<
    GroupKey,
    {
      categoryId: string;
      methodId: string;
      logoContentHash: string;
      placementIds: string[];
    }
  >();
  const placementCategoryMap = new Map(
    placements.map((p) => [p.id, p.feeCategoryId as string]),
  );

  for (const sel of draft.placements) {
    const categoryId = placementCategoryMap.get(sel.placementId);
    if (!categoryId) continue;
    const category = categoryById.get(categoryId);
    if (!category) continue;
    // Resolve hash for this placement: real hash if logo+contentHash present,
    // PENDING_LOGO_SENTINEL otherwise. Don't `continue` — "later" still
    // triggers fees per the spec amendment for that mode.
    const logoAssetId = draft.logoAssetIdsByPlacementId[sel.placementId];
    const realHash =
      typeof logoAssetId === "string" && logoAssetId.length > 0
        ? hashByLogoId.get(logoAssetId)
        : undefined;
    const hash = realHash ?? PENDING_LOGO_SENTINEL;
    const key = `${hash}|${categoryId}|${category.methodId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.placementIds.push(sel.placementId);
    } else {
      groups.set(key, {
        categoryId,
        methodId: category.methodId,
        logoContentHash: hash,
        placementIds: [sel.placementId],
      });
    }
  }

  if (groups.size === 0) return [];
  console.log(
    `[design-fees:compute] resolved ${groups.size} fee tuple(s) for cartToken=${cartToken.slice(0, 8)}…`,
  );

  // 4) Look up existing charges for this cartToken on these tuples in one query
  const groupArr = Array.from(groups.values());
  const existing = await db.cartDesignFeeCharge.findMany({
    where: {
      cartToken,
      OR: groupArr.map((g) => ({
        logoContentHash: g.logoContentHash,
        categoryId: g.categoryId,
        methodId: g.methodId,
      })),
    },
    select: {
      logoContentHash: true,
      categoryId: true,
      methodId: true,
    },
  });
  const chargedSet = new Set(
    existing.map((e) => `${e.logoContentHash}|${e.categoryId}|${e.methodId}`),
  );

  // 5) Compose decisions
  const decisions: FeeDecision[] = groupArr.map((g) => {
    const cat = categoryById.get(g.categoryId)!;
    const key = `${g.logoContentHash}|${g.categoryId}|${g.methodId}`;
    const alreadyCharged = chargedSet.has(key);
    return {
      categoryId: g.categoryId,
      categoryName: cat.name,
      methodId: g.methodId,
      logoContentHash: g.logoContentHash,
      alreadyCharged,
      feeCentsToCharge: alreadyCharged ? 0 : cat.feeCents,
      feeCentsSnapshot: cat.feeCents,
      placementIds: g.placementIds,
    };
  });

  return decisions;
}
