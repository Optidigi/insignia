import { useEffect, useReducer, useRef } from 'preact/hooks';
import { useAdminLocale } from '../shared/admin-i18n.js';
import {
  initialPermissionState,
  type PermissionNeeds,
  type PermissionOperation,
  permissionReducer,
} from './permissions-state';

const readinessScopes = ['read_cart_transforms', 'read_validations'];
const productAppScopes = ['write_products', 'read_publications'];
type ScopeDetail = { granted: string[]; optional: string[]; required: string[] };
type ReadinessPermissionsProps = {
  inspect: () => Promise<unknown>;
  onCheckStart?: () => void;
  onPermissionRequestStart?: () => void;
};
type ScopesApi = {
  query(): Promise<ScopeDetail>;
  request(scopes: string[]): Promise<{ result: 'granted-all' | 'declined-all'; detail: ScopeDetail }>;
};
function api(): ScopesApi {
  const scopes = (window as unknown as { shopify?: { scopes?: ScopesApi } }).shopify?.scopes;
  if (!scopes?.query || !scopes.request) throw new Error('Scope API unavailable');
  return scopes;
}
async function bounded<T>(task: () => Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Permission check timed out')), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function accessRefused(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'status' in error && (error.status === 401 || error.status === 403)
  );
}
/** Browser scopes only guide consent. Current server authentication remains authority. */
export default function ReadinessPermissions({
  inspect,
  onCheckStart,
  onPermissionRequestStart,
}: ReadinessPermissionsProps) {
  const { t: translateUi } = useAdminLocale();
  const [state, dispatch] = useReducer(permissionReducer, undefined, initialPermissionState);
  const { missing, missingProduct, status, access, setupAccess, orderAccess, productAccess } = state;
  const busy = state.phase === 'checking' || state.phase === 'requesting';
  const failed = state.phase === 'failed';
  const inFlight = useRef(false);
  const sequence = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current++;
    };
  }, []);
  function owns(attempt: number) {
    return mounted.current && sequence.current === attempt;
  }
  async function queryScopeNeeds(attempt: number): Promise<PermissionNeeds> {
    const detail = await bounded(() => api().query(), 10_000);
    if (
      !Array.isArray(detail.granted) ||
      !Array.isArray(detail.optional) ||
      !detail.granted.every((scope) => typeof scope === 'string') ||
      !detail.optional.every((scope) => typeof scope === 'string')
    )
      throw new Error('Invalid scope response');
    const checkout = readinessScopes.filter((scope) => !detail.granted.includes(scope));
    const product = productAppScopes.filter((scope) => !detail.granted.includes(scope));
    if ([...checkout, ...product].some((scope) => !detail.optional.includes(scope)))
      throw new Error('Permissions unavailable');
    const needs = { checkout, product };
    if (owns(attempt)) dispatch({ type: 'scopes-observed', attempt, needs, granted: detail.granted });
    return needs;
  }
  async function inspectCurrent(attempt: number) {
    const result = await inspect();
    if (
      typeof result === 'object' &&
      result !== null &&
      'version' in result &&
      result.version === 'm5-admin-technical-readiness-v1' &&
      'canRead' in result &&
      typeof result.canRead === 'boolean' &&
      'canEdit' in result &&
      typeof result.canEdit === 'boolean'
    ) {
      if (owns(attempt))
        dispatch({ type: 'access-observed', attempt, access: { canRead: result.canRead, canEdit: result.canEdit } });
    } else throw new Error('Invalid readiness response');
  }
  async function run(operation: PermissionOperation) {
    if (inFlight.current) return;
    const scopes =
      operation === 'checkout-consent' ? [...missing] : operation === 'product-consent' ? [...missingProduct] : [];
    if (operation !== 'check' && !scopes.length) return;
    inFlight.current = true;
    const attempt = ++sequence.current;
    dispatch({ type: 'operation-started', attempt, operation });
    try {
      if (operation === 'check') onCheckStart?.();
      else onPermissionRequestStart?.();
      if (operation !== 'check') {
        const response = await bounded(() => api().request(scopes), 120_000);
        if (!owns(attempt)) return;
        if (response.result === 'declined-all') {
          dispatch({ type: 'consent-declined', attempt });
          return;
        }
        if (response.result !== 'granted-all') throw new Error('Invalid permission response');
      }
      const needs = await queryScopeNeeds(attempt);
      if (!owns(attempt)) return;
      if (!needs.product.includes('write_products') && !needs.checkout.length) await inspectCurrent(attempt);
      if (owns(attempt)) dispatch({ type: 'verification-finished', attempt, needs });
    } catch (error) {
      if (owns(attempt)) dispatch({ type: 'verification-failed', attempt, refused: accessRefused(error) });
    } finally {
      if (sequence.current === attempt) inFlight.current = false;
    }
  }
  const check = () => run('check');
  const allow = () => run('checkout-consent');
  const allowProductSetup = () => run('product-consent');
  const primaryConsent = missing.length ? 'checkout' : missingProduct.length ? 'product' : null;
  return (
    <s-stack gap="large">
      <s-section
        heading={translateUi('settings:readinessPermissions.accessChecks')}
        subheading={translateUi('settings:readinessPermissions.checkProductConfigurationAccessAndSetupPermissions')}
      >
        <s-stack gap="base">
          <s-box>
            <s-stack gap="small">
              <div class="admin-permission-heading">
                <div class="admin-permission-title">
                  <s-heading>{translateUi('settings:readinessPermissions.yourProductAccess')}</s-heading>
                </div>
                <div class="admin-permission-status">
                  <s-badge tone={access ? (access.canEdit ? 'success' : 'warning') : 'neutral'}>
                    {access
                      ? access.canEdit
                        ? translateUi('settings:readinessPermissions.canEdit')
                        : access.canRead
                          ? translateUi('settings:readinessPermissions.viewOnly')
                          : translateUi('settings:readinessPermissions.unavailable')
                      : translateUi('settings:readinessPermissions.notChecked')}
                  </s-badge>
                </div>
              </div>
              <s-paragraph color="subdued">
                {access
                  ? access.canEdit
                    ? translateUi('settings:readinessPermissions.canEditDescription')
                    : access.canRead
                      ? productAccess?.canWriteProducts === false
                        ? translateUi('settings:readinessPermissions.needsProductWrite')
                        : translateUi('settings:readinessPermissions.staffWrite')
                      : translateUi('settings:readinessPermissions.unverifiedDescription')
                  : setupAccess === false
                    ? translateUi('settings:readinessPermissions.notCheckedDescription')
                    : translateUi('settings:readinessPermissions.accessDescription')}
              </s-paragraph>
              {productAccess && (
                <s-paragraph>
                  {translateUi('settings:readinessPermissions.productPermissionSummary', {
                    productEditing: translateUi(
                      productAccess.canWriteProducts
                        ? 'settings:readinessPermissions.granted'
                        : 'settings:readinessPermissions.notGranted',
                    ),
                    publicationSettings: translateUi(
                      productAccess.canReadPublications
                        ? 'settings:readinessPermissions.granted'
                        : 'settings:readinessPermissions.notGranted',
                    ),
                  })}
                </s-paragraph>
              )}
            </s-stack>
          </s-box>
          <s-divider />
          <s-box>
            <s-stack gap="small">
              <div class="admin-permission-heading">
                <div class="admin-permission-title">
                  <s-heading>{translateUi('settings:readinessPermissions.checkoutSetupChecks')}</s-heading>
                </div>
                <div class="admin-permission-status">
                  <s-badge tone={setupAccess === true ? 'success' : setupAccess === false ? 'warning' : 'neutral'}>
                    {setupAccess === true
                      ? translateUi('settings:readinessPermissions.allowed')
                      : setupAccess === false
                        ? translateUi('settings:readinessPermissions.permissionNeeded')
                        : failed
                          ? translateUi('settings:readinessPermissions.notVerified')
                          : translateUi('settings:readinessPermissions.notChecked')}
                  </s-badge>
                </div>
              </div>
              <s-paragraph color="subdued">
                {translateUi(
                  'settings:readinessPermissions.readAccessToCartTransformsAndCheckoutValidationsTheseChecksDoNotChangeYourStore',
                )}
              </s-paragraph>
            </s-stack>
          </s-box>
          <s-divider />
          <s-box>
            <s-stack gap="small">
              <div class="admin-permission-heading">
                <div class="admin-permission-title">
                  <s-heading>{translateUi('settings:readinessPermissions.ordersAndArtwork')}</s-heading>
                </div>
                <div class="admin-permission-status">
                  <s-badge tone={orderAccess === true ? 'success' : orderAccess === false ? 'warning' : 'neutral'}>
                    {orderAccess === true
                      ? translateUi('settings:readinessPermissions.orderAllowed')
                      : orderAccess === false
                        ? translateUi('settings:readinessPermissions.orderNeeded')
                        : translateUi('settings:readinessPermissions.notChecked')}
                  </s-badge>
                </div>
              </div>
              <s-paragraph color="subdued">
                {translateUi('settings:readinessPermissions.requiresTheStoreOwnerSAccountAndShopifyOrderAccess')}
              </s-paragraph>
              {orderAccess === false && (
                <s-paragraph>
                  {translateUi(
                    'settings:readinessPermissions.theStoreOwnerCanReviewInsigniaSOrderPermissionsInShopify',
                  )}
                </s-paragraph>
              )}
            </s-stack>
          </s-box>
          <s-divider />
          {status && (
            <div role={failed ? 'alert' : 'status'}>
              <s-paragraph tone={failed ? 'critical' : 'neutral'}>
                {translateUi(`settings:permissionStatus.${status}`)}
              </s-paragraph>
            </div>
          )}
          <s-stack direction="inline" gap="small">
            {missing.length > 0 && (
              <s-button
                variant={primaryConsent === 'checkout' ? 'primary' : 'secondary'}
                loading={busy}
                disabled={busy}
                onClick={() => void allow()}
              >
                {translateUi('settings:readinessPermissions.allowSetupChecks')}
              </s-button>
            )}
            {missingProduct.length > 0 && (
              <s-button
                variant={primaryConsent === 'product' ? 'primary' : 'secondary'}
                loading={busy}
                disabled={busy}
                onClick={() => void allowProductSetup()}
              >
                {translateUi('settings:readinessPermissions.allowProductSetup')}
              </s-button>
            )}
            <s-button
              variant={primaryConsent ? 'secondary' : 'primary'}
              loading={busy && missing.length === 0}
              disabled={busy}
              onClick={() => void check()}
            >
              {translateUi('settings:readinessPermissions.checkAccess')}
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>
      <s-paragraph color="subdued">
        {translateUi('settings:readinessPermissions.manageInsigniaSPermissionsInShopifySAppSettings')}
      </s-paragraph>
    </s-stack>
  );
}
