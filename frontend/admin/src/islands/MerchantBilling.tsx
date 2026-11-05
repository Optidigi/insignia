import { useEffect, useReducer, useRef } from 'preact/hooks';
import { BillingContentSkeleton } from '../components/AdminPageSkeleton';
import { useAdminLocale, withAdminLocale } from '../shared/admin-i18n.js';
import { useAdminPageReady } from '../shared/admin-page-ready';
import { authenticatedJson } from '../shared/admin-request.js';
import { billingMoney, billingPercentage } from '../shared/billing-display';
import type { BillingView } from '../shared/billing-view.js';
import { initialRemoteReadState, remoteReadReducer } from '../shared/remote-read-state';
import '../styles/merchant-billing.css';

function date(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value));
}
function MerchantBilling() {
  const { t: translateUi, formatLocale } = useAdminLocale();
  const [read, dispatch] = useReducer(remoteReadReducer<BillingView>, undefined, initialRemoteReadState<BillingView>);
  const view = read.value;
  const busy = read.phase === 'loading';
  const failed = read.phase === 'failed' || read.phase === 'denied' || read.phase === 'missing';
  const denied = read.phase === 'denied';
  const forbidden = read.status === 403;
  useAdminPageReady(!busy);
  const inFlight = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  async function refresh() {
    if (inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    const request = ++sequence.current;
    dispatch({ type: 'read-started', request, clear: true });
    try {
      const value = await authenticatedJson<BillingView>('/api/admin/billing', { signal: controller.signal });
      if (inFlight.current === controller && !controller.signal.aborted)
        dispatch({ type: 'read-succeeded', request, value });
    } catch (error: unknown) {
      if (inFlight.current !== controller || controller.signal.aborted) return;
      const status =
        typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
          ? error.status
          : undefined;
      dispatch({ type: 'read-failed', request, status, message: '' });
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }
  useEffect(() => {
    void refresh();
    return () => {
      sequence.current++;
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, []);
  const statusLabel =
    view?.status === 'trial'
      ? translateUi('settings:merchantBilling.trialActive')
      : view?.status === 'active'
        ? translateUi('settings:merchantBilling.subscriptionActive')
        : view?.status === 'inactive'
          ? translateUi('settings:merchantBilling.noActiveSubscription')
          : translateUi('settings:merchantBilling.notVerified');
  const recognized = view?.status === 'active' || view?.status === 'trial';
  const showStandardPrice = recognized && view?.developmentTerms;
  const managementLabel =
    view?.status === 'inactive'
      ? translateUi('settings:merchantBilling.choosePlan')
      : recognized
        ? translateUi('settings:merchantBilling.managePlan')
        : translateUi('settings:merchantBilling.viewPlans');
  return (
    <s-page inlineSize="small" heading={translateUi('settings:merchantBilling.billing')}>
      <s-link slot="breadcrumb-actions" href="/admin/settings">
        {translateUi('settings:merchantBilling.settings')}
      </s-link>
      <s-section
        heading={
          recognized
            ? translateUi('settings:merchantBilling.standardPlanName')
            : translateUi('settings:merchantBilling.subscriptionStatus')
        }
      >
        {view && (
          <s-badge
            slot="supplemental"
            tone={view.status === 'active' || view.status === 'trial' ? 'success' : 'neutral'}
          >
            {statusLabel}
          </s-badge>
        )}
        {busy && (
          <BillingContentSkeleton label={translateUi('settings:merchantBilling.checkingCurrentShopifySubscription')} />
        )}
        {failed && (
          <s-stack gap="base">
            <s-banner tone="critical" heading={translateUi('settings:merchantBilling.billingStatusUnavailable')}>
              <s-paragraph>
                {denied
                  ? forbidden
                    ? translateUi('settings:merchantBilling.ownerAccess')
                    : translateUi('settings:merchantBilling.reopenAccess')
                  : translateUi('settings:merchantBilling.verificationFailed')}
              </s-paragraph>
            </s-banner>
            {!denied && (
              <s-button variant="primary" onClick={() => void refresh()}>
                {translateUi('settings:merchantBilling.tryAgain')}
              </s-button>
            )}
          </s-stack>
        )}
        {view && (
          <s-stack gap="base">
            {view.recurringPrice ? (
              <div class="billing-price">
                <s-text color="subdued">
                  {view.developmentTerms
                    ? translateUi('settings:merchantBilling.developmentTerms')
                    : view.recurringDiscount
                      ? translateUi('settings:merchantBilling.baseRate')
                      : view.status === 'trial'
                        ? translateUi('settings:merchantBilling.afterTrial')
                        : translateUi('settings:merchantBilling.subscriptionRate')}
                </s-text>
                <div class="billing-price-value">
                  <span class="billing-amount">
                    {billingMoney(view.recurringPrice.amount, view.recurringPrice.currency, formatLocale)}
                  </span>
                  <s-text color="subdued">{translateUi('settings:merchantBilling.per30Days')}</s-text>
                </div>
              </div>
            ) : (
              <s-paragraph color="subdued">
                {view.status === 'inactive'
                  ? translateUi('settings:merchantBilling.chooseSubscription')
                  : translateUi('settings:merchantBilling.priceUnverified')}
              </s-paragraph>
            )}
            {(showStandardPrice || view.trialEndsAt || view.currentCycle || view.recurringDiscount) && (
              <>
                <s-divider />
                <dl class="billing-facts">
                  {showStandardPrice && (
                    <div>
                      <dt>
                        <s-text color="subdued">{translateUi('settings:merchantBilling.standardPlanPrice')}</s-text>
                      </dt>
                      <dd>
                        {translateUi('settings:merchantBilling.standardRate', {
                          amount: billingMoney(view.standardPrice.amount, view.standardPrice.currency, formatLocale),
                          count: view.standardPrice.intervalDays,
                        })}
                      </dd>
                    </div>
                  )}
                  {view.recurringDiscount && view.recurringPrice && (
                    <div>
                      <dt>
                        <s-text color="subdued">{translateUi('settings:merchantBilling.discount')}</s-text>
                      </dt>
                      <dd>
                        <s-stack gap="small-200">
                          {view.recurringDiscount.percentage !== null && (
                            <s-text>
                              {translateUi('settings:merchantBilling.percentageDiscount', {
                                percentage: billingPercentage(view.recurringDiscount.percentage, formatLocale),
                              })}
                            </s-text>
                          )}
                          {view.recurringDiscount.amount !== null && (
                            <s-text>
                              {translateUi('settings:merchantBilling.amountDiscount', {
                                amount: billingMoney(
                                  view.recurringDiscount.amount,
                                  view.recurringPrice.currency,
                                  formatLocale,
                                ),
                              })}
                            </s-text>
                          )}
                          {view.recurringDiscount.remainingCycles !== null && (
                            <s-text color="subdued">
                              {translateUi('settings:merchantBilling.remainingCycles', {
                                count: view.recurringDiscount.remainingCycles,
                              })}
                            </s-text>
                          )}
                          {view.recurringDiscount.endsAt && (
                            <s-text color="subdued" data-date-time={view.recurringDiscount.endsAt}>
                              {translateUi('settings:merchantBilling.discountEnds', {
                                date: date(view.recurringDiscount.endsAt, formatLocale),
                              })}
                            </s-text>
                          )}
                        </s-stack>
                      </dd>
                    </div>
                  )}
                  {view.trialEndsAt && (
                    <div>
                      <dt>
                        <s-text color="subdued">{translateUi('settings:merchantBilling.trialEnds')}</s-text>
                      </dt>
                      <dd>
                        <s-text data-date-time={view.trialEndsAt}>{date(view.trialEndsAt, formatLocale)}</s-text>
                      </dd>
                    </div>
                  )}
                  {view.currentCycle && (
                    <div>
                      <dt>
                        <s-text color="subdued">{translateUi('settings:merchantBilling.currentBillingPeriod')}</s-text>
                      </dt>
                      <dd>
                        <s-text data-date-time={view.currentCycle.startTime}>
                          {date(view.currentCycle.startTime, formatLocale)}
                        </s-text>
                        <span class="billing-date-separator">
                          <s-text color="subdued">–</s-text>
                        </span>
                        <s-text data-date-time={view.currentCycle.endTime}>
                          {date(view.currentCycle.endTime, formatLocale)}
                        </s-text>
                      </dd>
                    </div>
                  )}
                </dl>
              </>
            )}
            {(view.scheduledCancellation || view.pendingChange) && (
              <div class="billing-changes">
                {view.scheduledCancellation && (
                  <s-stack gap="small">
                    <s-badge tone="warning">{translateUi('settings:merchantBilling.cancellationScheduled')}</s-badge>
                    <s-paragraph>
                      {translateUi(
                        'settings:merchantBilling.currentAccessLastsUntilShopifySCurrentTrialOrBillingPeriodEnds',
                      )}
                    </s-paragraph>
                  </s-stack>
                )}
                {view.pendingChange && (
                  <s-stack gap="small">
                    <s-badge>{translateUi('settings:merchantBilling.changePending')}</s-badge>
                    <s-paragraph>
                      {translateUi(
                        'settings:merchantBilling.aSubscriptionChangeIsPendingInShopifyYourCurrentAccessContinuesToFollowTheConfirmedSubscri',
                      )}
                    </s-paragraph>
                  </s-stack>
                )}
              </div>
            )}
            {!view.newActionsAllowed && (
              <s-banner
                tone="warning"
                heading={
                  view.status === 'unavailable'
                    ? translateUi('settings:merchantBilling.statusUnverified')
                    : translateUi('settings:merchantBilling.needsAttention')
                }
              >
                {translateUi(
                  'settings:merchantBilling.newCustomizationsAndProductPublicationAreUnavailableExistingOrdersAndRetainedArtworkRemain',
                )}
              </s-banner>
            )}
            {view.status === 'unavailable' && (
              <s-stack gap="small">
                <s-button onClick={() => void refresh()}>{translateUi('settings:merchantBilling.tryAgain')}</s-button>
              </s-stack>
            )}
            <s-divider />
            {view.managementUrl ? (
              <div class="admin-action-wrap">
                <s-button href={view.managementUrl} target="_top" variant="primary" inlineSize="fill">
                  <span class="admin-action-label">{managementLabel}</span>
                </s-button>
              </div>
            ) : (
              <s-paragraph>
                {translateUi('settings:merchantBilling.billingManagementIsUnavailableContactSupport')}
              </s-paragraph>
            )}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export default withAdminLocale(MerchantBilling);
