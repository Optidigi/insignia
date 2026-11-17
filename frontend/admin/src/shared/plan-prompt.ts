/**
 * Shopify managed pricing: a store without a plan is sent to Shopify's plan selection page.
 * Only a fresh billing read that found no active or trial subscription qualifies; an unverified,
 * unrecognized, busy or failed read never does.
 */
const pricingPlans = /^https:\/\/admin\.shopify\.com\/store\/[a-z0-9][a-z0-9-]*\/charges\/[a-z0-9-]+\/pricing_plans$/;
const promptedKey = 'insignia:plan-selection-prompted';

/** The plan selection URL from a `/api/admin/billing` answer, or null when the answer is not a definitive "no plan". */
export function planSelectionTarget(view: unknown): string | null {
  if (!view || typeof view !== 'object') return null;
  const { status, managementUrl } = view as { status?: unknown; managementUrl?: unknown };
  return status === 'inactive' && typeof managementUrl === 'string' && pricingPlans.test(managementUrl)
    ? managementUrl
    : null;
}

/**
 * Claims the single automatic prompt of this browser session. A merchant who returns without choosing
 * a plan keeps the banner and is not sent away again. Without storage that remembers the claim there is
 * no automatic prompt at all, so it can never loop.
 */
export function claimPlanSelectionPrompt(storage: () => Pick<Storage, 'getItem' | 'setItem'>): boolean {
  try {
    const session = storage();
    if (session.getItem(promptedKey) !== null) return false;
    session.setItem(promptedKey, '1');
    return session.getItem(promptedKey) !== null;
  } catch {
    return false;
  }
}
