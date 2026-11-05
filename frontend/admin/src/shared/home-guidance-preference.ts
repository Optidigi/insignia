import { type HomeGuidanceStepId, homeGuidanceStepIds } from './merchant-home.ts';

/** Browser-local guide progress, separate from product/theme state and app authority. */
export type HomePreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function homeGuidanceStorageKey(shop: unknown): string | null {
  return typeof shop === 'string' && /^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/.test(shop)
    ? `insignia:home-introduction:v2:${shop}`
    : null;
}

export function homeGuidanceIsDismissed(storage: HomePreferenceStorage | null, shop: unknown): boolean {
  const key = homeGuidanceStorageKey(shop);
  if (!key || !storage) return false;
  try {
    return storage.getItem(key) === 'dismissed';
  } catch {
    return false;
  }
}

export function saveHomeGuidanceDismissed(
  storage: HomePreferenceStorage | null,
  shop: unknown,
  dismissed: boolean,
): boolean {
  const key = homeGuidanceStorageKey(shop);
  if (!key || !storage) return false;
  try {
    if (dismissed) storage.setItem(key, 'dismissed');
    else storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function homePreferenceStorage(): HomePreferenceStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Manual guide acknowledgments never publish products or configure a theme. */
export function homeGuidanceCompletedSteps(storage: HomePreferenceStorage | null, shop: unknown): HomeGuidanceStepId[] {
  const scope = homeGuidanceStorageKey(shop);
  if (!scope || !storage) return [];
  try {
    const value: unknown = JSON.parse(storage.getItem(`${scope}:steps`) ?? '[]');
    return Array.isArray(value) ? homeGuidanceStepIds.filter((id) => value.includes(id)) : [];
  } catch {
    return [];
  }
}

export function saveHomeGuidanceCompletedSteps(
  storage: HomePreferenceStorage | null,
  shop: unknown,
  steps: HomeGuidanceStepId[],
): boolean {
  const scope = homeGuidanceStorageKey(shop);
  if (!scope || !storage) return false;
  try {
    storage.setItem(`${scope}:steps`, JSON.stringify(homeGuidanceStepIds.filter((id) => steps.includes(id))));
    return true;
  } catch {
    return false;
  }
}
