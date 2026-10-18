import { useEffect, useRef, useState } from 'preact/hooks';
import AdminSkeleton from '../components/AdminSkeleton';
import SettingsNavigation from '../components/SettingsNavigation';
import { useAdminPageReady } from '../shared/admin-page-ready';
import { authenticatedJson } from '../shared/admin-request.js';
import type { BillingView } from '../shared/billing-view.js';

function date(value: string): string {
  return `${new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(
    new Date(value),
  )} UTC`;
}
export default function MerchantBilling() {
  const [view, setView] = useState<BillingView | null>(null);
  const [busy, setBusy] = useState(true);
  useAdminPageReady(!busy);
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
    <s-page inlineSize="large" heading="Billing">
      <s-link slot="breadcrumb-actions" href="/admin/settings">
        Settings
      </s-link>
      <SettingsNavigation current="billing" />
      <s-section heading="Insignia Standard">
        <s-stack gap="base">
          <s-paragraph>Subscription price: USD 49.99 per 30 days.</s-paragraph>
          <s-paragraph>
            All available Insignia features. No per-order charges. Artwork size, retention and other technical limits
            still apply.
          </s-paragraph>
        </s-stack>
      </s-section>
      <s-section heading="Current subscription">
        <s-stack gap="base">
          {busy && <AdminSkeleton variant="detail" label="Checking current Shopify subscription" />}
          {failed && (
            <div role="alert">
              <s-paragraph>Billing status could not be verified. Try again.</s-paragraph>
            </div>
          )}
          {view && (
            <>
              <div role="status">
                <s-paragraph>
                  <s-badge tone={view.status === 'active' || view.status === 'trial' ? 'success' : 'neutral'}>
                    {view.status === 'trial'
                      ? 'Trial active'
                      : view.status === 'active'
                        ? 'Subscription active'
                        : view.status === 'inactive'
                          ? 'No active subscription'
                          : 'Current subscription could not be verified'}
                  </s-badge>
                </s-paragraph>
              </div>
              {view.recurringPrice && (
                <s-paragraph>
                  {view.developmentTerms ? 'Development test terms' : 'Current Shopify subscription price'}:{' '}
                  {view.recurringPrice.currency} {view.recurringPrice.amount} per 30 days.
                </s-paragraph>
              )}
              {view.trialEndsAt && (
                <s-paragraph>
                  Trial ends <time dateTime={view.trialEndsAt}>{date(view.trialEndsAt)}</time>.
                </s-paragraph>
              )}
              {view.currentCycle && (
                <s-paragraph>
                  Current cycle: <time dateTime={view.currentCycle.startTime}>{date(view.currentCycle.startTime)}</time>{' '}
                  to <time dateTime={view.currentCycle.endTime}>{date(view.currentCycle.endTime)}</time>.
                </s-paragraph>
              )}
              {view.scheduledCancellation && (
                <s-paragraph>
                  Cancellation is scheduled. Current access lasts only until Shopify’s current trial or cycle ends.
                </s-paragraph>
              )}
              {view.pendingChange && (
                <s-paragraph>
                  A subscription change is pending in Shopify. Pending terms do not grant access.
                </s-paragraph>
              )}
              {!view.newActionsAllowed && (
                <s-paragraph>
                  New customization offers and publication are unavailable. Existing authorized purchases and artwork
                  remain available within their original limits.
                </s-paragraph>
              )}
              {view.observedAt && (
                <s-paragraph>
                  Last checked <time dateTime={view.observedAt}>{date(view.observedAt)}</time>.
                </s-paragraph>
              )}
              {view.managementUrl ? (
                <s-paragraph>
                  <s-button href={view.managementUrl} target="_top" variant="primary">
                    Manage billing in Shopify
                  </s-button>
                </s-paragraph>
              ) : (
                <s-paragraph>Billing management is unavailable. Contact support.</s-paragraph>
              )}
            </>
          )}
          <s-button disabled={busy} onClick={() => void refresh()}>
            Refresh billing status
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}
