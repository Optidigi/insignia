import { useEffect, useRef, useState } from 'preact/hooks';
import { authenticatedJson } from '../shared/admin-request.js';
import type { BillingView } from '../shared/billing-view.js';

function date(value: string): string {
  return `${new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(
    new Date(value),
  )} UTC`;
}
export default function MerchantBilling() {
  const [view, setView] = useState<BillingView | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    setView(null);
    try {
      setView(await authenticatedJson<BillingView>('/api/admin/billing'));
    } catch {
      setFailed(true);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <s-page heading="Billing">
      <s-section heading="Insignia Standard">
        <p>Standard commercial price: USD 49.99 per 30 days.</p>
        <p>
          All released Lean V1 features. No per-order charges. Artwork size, retention and other technical limits still
          apply.
        </p>
        {busy && <p role="status">Checking current Shopify subscription…</p>}
        {failed && <p role="alert">Billing status could not be verified. Try again.</p>}
        {view && (
          <>
            <p role="status">
              {view.status === 'trial'
                ? 'Trial active'
                : view.status === 'active'
                  ? 'Subscription active'
                  : view.status === 'inactive'
                    ? 'No active subscription'
                    : 'Current subscription could not be verified'}
            </p>
            {view.recurringPrice && (
              <p>
                {view.developmentTerms ? 'Development test terms' : 'Current provider recurring price'}:{' '}
                {view.recurringPrice.currency} {view.recurringPrice.amount} per 30 days.
              </p>
            )}
            {view.trialEndsAt && (
              <p>
                Trial ends <time dateTime={view.trialEndsAt}>{date(view.trialEndsAt)}</time>.
              </p>
            )}
            {view.currentCycle && (
              <p>
                Current cycle: <time dateTime={view.currentCycle.startTime}>{date(view.currentCycle.startTime)}</time>{' '}
                to <time dateTime={view.currentCycle.endTime}>{date(view.currentCycle.endTime)}</time>.
              </p>
            )}
            {view.scheduledCancellation && (
              <p>Cancellation is scheduled. Current access lasts only until Shopify’s current trial or cycle ends.</p>
            )}
            {view.pendingChange && (
              <p>A subscription change is pending in Shopify. Pending terms do not grant access.</p>
            )}
            {!view.newActionsAllowed && (
              <p>
                New customization offers and publication are unavailable. Existing authorized purchases and artwork
                remain available within their original limits.
              </p>
            )}
            {view.observedAt && (
              <p>
                Last checked <time dateTime={view.observedAt}>{date(view.observedAt)}</time>.
              </p>
            )}
            {view.managementUrl ? (
              <p>
                <a href={view.managementUrl} target="_top" rel="noreferrer">
                  Manage billing in Shopify
                </a>
              </p>
            ) : (
              <p>Billing management is unavailable. Contact support.</p>
            )}
          </>
        )}
        <s-button disabled={busy} onClick={() => void refresh()}>
          Refresh billing status
        </s-button>
      </s-section>
    </s-page>
  );
}
