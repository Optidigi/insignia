/** Browser-safe current billing observation. A display never grants new-action eligibility. */
export interface BillingView {
  status: 'trial' | 'active' | 'inactive' | 'unavailable';
  observedAt: string | null;
  trialEndsAt: string | null;
  currentCycle: { startTime: string; endTime: string } | null;
  scheduledCancellation: boolean;
  pendingChange: boolean;
  newActionsAllowed: boolean;
  standardPrice: { amount: '49.99'; currency: 'USD'; intervalDays: 30 } | null;
  recurringPrice: { amount: string; currency: string; billingPeriod: 'EVERY_30_DAYS' | 'ANNUAL' } | null;
  developmentTerms: boolean;
  managementUrl: string | null;
}
