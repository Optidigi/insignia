import { useState } from 'preact/hooks';
import { useAdminLocale, withAdminLocale } from '../shared/admin-i18n.js';
import { useAdminPageReady } from '../shared/admin-page-ready';
import { authenticatedJson } from '../shared/admin-request';
import ReadinessPermissions from './ReadinessPermissions';

function MerchantPermissions() {
  const { t: translateUi } = useAdminLocale();
  const [permissionIssue, setPermissionIssue] = useState<'session' | 'product' | null>(null);
  useAdminPageReady(true);

  async function inspectReadiness() {
    try {
      const result = await authenticatedJson('/api/admin/readiness', {}, true);
      setPermissionIssue(null);
      return result;
    } catch (error) {
      const status =
        typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
          ? error.status
          : null;
      if (status === 401) setPermissionIssue('session');
      if (status === 403) setPermissionIssue('product');
      throw error;
    }
  }

  function clearProductIssue() {
    setPermissionIssue((current) => (current === 'product' ? null : current));
  }

  return (
    <s-page inlineSize="small" heading={translateUi('settings:merchantPermissions.appPermissions')}>
      <s-link slot="breadcrumb-actions" href="/admin/settings">
        {translateUi('settings:merchantPermissions.settings')}
      </s-link>
      {permissionIssue === 'session' && (
        <s-banner tone="critical" heading={translateUi('settings:merchantPermissions.shopifySessionUnavailable')}>
          {translateUi(
            'settings:merchantPermissions.reopenInsigniaFromShopifyAdminToRestoreYourSessionThenCheckAccessAgain',
          )}
        </s-banner>
      )}
      {permissionIssue === 'product' && (
        <s-banner tone="critical" heading={translateUi('settings:merchantPermissions.productAccessUnavailable')}>
          {translateUi(
            'settings:merchantPermissions.thisShopifyAccountCannotReadInsigniaProductConfigurationsAskAStoreOwnerToReviewTheAppSProd',
          )}
        </s-banner>
      )}
      {permissionIssue !== 'session' && (
        <ReadinessPermissions
          inspect={inspectReadiness}
          onCheckStart={clearProductIssue}
          onPermissionRequestStart={clearProductIssue}
        />
      )}
    </s-page>
  );
}

export default withAdminLocale(MerchantPermissions);
