/** Public UI capability flag. Every purchase and configuration command has its own server authority. */
export function monthlyBillingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.INSIGNIA_M5_ENTITLEMENT_POLICY_JSON;
  if (!raw) return false;
  try {
    const policy = JSON.parse(raw) as { plans?: { planHandle?: string }[] };
    return policy.plans?.some((plan) => plan.planHandle === 'insignia-pro') ?? false;
  } catch {
    return true;
  }
}
