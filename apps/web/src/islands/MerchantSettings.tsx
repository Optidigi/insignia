import { useState } from 'preact/hooks';
import SettingsNavigation from '../components/SettingsNavigation';
import { authenticatedJson } from '../shared/admin-request';
import ReadinessPermissions from './ReadinessPermissions';

export default function MerchantSettings() {
  const [denied, setDenied] = useState('');
  return (
    <s-page heading="Settings">
      <SettingsNavigation current="general" />
      <s-paragraph>
        Manage store-wide setup here. Product rules, images and decoration prices belong in each product’s
        configuration.
      </s-paragraph>
      {denied ? (
        <s-banner tone="critical" heading="Reopen Insignia from Shopify Admin">
          <p>{denied}</p>
        </s-banner>
      ) : (
        <ReadinessPermissions
          inspect={() =>
            authenticatedJson('/api/admin/readiness', {}, true).catch((error) => {
              if ([401, 403].includes((error as { status?: number }).status ?? 0)) setDenied(error.message);
              throw error;
            })
          }
        />
      )}
      <s-section heading="Subscription and access">
        <s-paragraph>Review your current plan, trial and access. Shopify manages subscription changes.</s-paragraph>
        <s-link href="/admin/settings/billing">Manage billing</s-link>
      </s-section>
      <s-section heading="Customer data">
        <s-paragraph>
          Review privacy requests, export retained order data and find original artwork. Expired or erased files stay
          unavailable.
        </s-paragraph>
        <s-link href="/admin/settings/privacy">View customer privacy requests</s-link>
      </s-section>
      <s-section heading="Storefront setup">
        <s-paragraph>
          Connect your published product configuration to the customization button in your theme. Review the app block,
          button label and cart-repair embed in Shopify’s theme editor.
        </s-paragraph>
        <s-link href="/admin/settings/storefront">Set up your storefront</s-link>
      </s-section>
      <s-section heading="Decoration methods">
        <s-paragraph>
          Maintain your store’s reusable method names, then add independent copies to product configurations. Prices and
          print areas remain product-specific.
        </s-paragraph>
        <s-link href="/admin/settings/methods">Manage method library</s-link>
      </s-section>
      <s-section heading="Product customization">
        <s-paragraph>
          Choose a product, configure its options and preview, save your draft, then publish reviewed changes.
        </s-paragraph>
        <s-link href="/admin/products">Configure products</s-link>
      </s-section>
    </s-page>
  );
}
