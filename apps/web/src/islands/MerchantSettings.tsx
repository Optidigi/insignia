import { useState } from 'preact/hooks';
import { authenticatedJson } from '../shared/admin-request';
import ReadinessPermissions from './ReadinessPermissions';

export default function MerchantSettings() {
  const [denied, setDenied] = useState('');
  return (
    <s-page heading="Settings">
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
        <s-link href="/admin/billing">Manage billing</s-link>
      </s-section>
      <s-section heading="Customer data">
        <s-paragraph>
          Review privacy requests, export retained order data and find original artwork. Expired or erased files stay
          unavailable.
        </s-paragraph>
        <s-link href="/admin/privacy">View customer privacy requests</s-link>
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
