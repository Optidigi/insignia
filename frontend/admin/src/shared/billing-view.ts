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
