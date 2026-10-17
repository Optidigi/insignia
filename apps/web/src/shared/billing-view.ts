/** Browser-safe current billing observation. A display never grants new-action eligibility. */
export interface BillingView {
  status: 'trial' | 'active' | 'inactive' | 'unavailable';
  observedAt: string | null;
  trialEndsAt: string | null;
  currentCycle: { startTime: string; endTime: string } | null;
  scheduledCancellation: boolean;
  pendingChange: boolean;
  newActionsAllowed: boolean;
  standardPrice: { amount: '49.99'; currency: 'USD'; intervalDays: 30 };
  recurringPrice: { amount: string; currency: string } | null;
  developmentTerms: boolean;
  managementUrl: string | null;
}
