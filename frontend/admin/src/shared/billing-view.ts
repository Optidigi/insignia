/** Browser-safe current billing observation. A display never grants new-action eligibility. */
type BillingPlan = {
  name: 'Insignia Free' | 'Insignia Standard' | 'Insignia Pro';
  monthlyAmount: '0.00' | '49.99' | '69.99';
};

export interface BillingView {
  status: 'trial' | 'active' | 'inactive' | 'unavailable';
  observedAt: string | null;
  trialEndsAt: string | null;
  currentCycle: { startTime: string; endTime: string } | null;
  scheduledCancellation: boolean;
  pendingChange: boolean;
  newActionsAllowed: boolean;
  plan?: BillingPlan | null;
  pendingPlan?: BillingPlan | null;
  productionTools?: boolean;
  freeProductId?: string | null;
  standardPrice: { amount: '49.99'; currency: 'USD'; intervalDays: 30 } | null;
  recurringPrice: { amount: string; currency: string; billingPeriod: 'EVERY_30_DAYS' | 'ANNUAL' } | null;
  /** Provider discount metadata for a recognized recurring item; never a computed net price. */
  recurringDiscount?: {
    amount: string | null;
    percentage: string | null;
    remainingCycles: number | null;
    endsAt: string | null;
  } | null;
  developmentTerms: boolean;
  managementUrl: string | null;
}
