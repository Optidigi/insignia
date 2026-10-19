import { useState } from 'preact/hooks';
import AdminDisclosure from '../components/AdminDisclosure';
import { useAdminPageReady } from '../shared/admin-page-ready';
import { authenticatedJson } from '../shared/admin-request';
import ReadinessPermissions from './ReadinessPermissions';

const groups = [
  {
    title: 'Store configuration',
    rows: [
      {
        title: 'Decoration methods',
        description: 'Reusable method names for your products. Each product keeps its own prices and print areas.',
        icon: 'paint-brush-round',
        href: '/admin/settings/methods',
      },
      {
        title: 'Storefront setup',
        description: 'Connect product configuration, the customization button and cart repair in your theme.',
        icon: 'store',
        href: '/admin/settings/storefront',
      },
    ],
  },
  {
    title: 'Account and data',
    rows: [
      {
        title: 'Billing',
        description: 'Your subscription, trial and Shopify billing management.',
        icon: 'credit-card',
        href: '/admin/settings/billing',
      },
      {
        title: 'Privacy',
        description: 'Customer data requests, retained order exports and original artwork.',
        icon: 'lock',
        href: '/admin/settings/privacy',
      },
    ],
  },
] as const;
export default function MerchantSettings() {
  const [denied, setDenied] = useState('');
  useAdminPageReady(true);
  return (
    <s-page inlineSize="small" heading="Settings">
      {groups.map((group) => (
        <s-section key={group.title} heading={group.title} padding="none">
          <s-stack gap="base">
            <s-stack gap="none">
              {group.rows.map((row) => (
                <s-clickable key={row.href} href={row.href} accessibilityLabel={row.title}>
                  <s-box padding="base">
                    <s-grid gridTemplateColumns="auto 1fr auto" gap="base" alignItems="center">
                      <s-icon type={row.icon} />
                      <s-stack gap="small">
                        <s-text type="strong">{row.title}</s-text>
                        <s-text color="subdued">{row.description}</s-text>
                      </s-stack>
                      <s-icon type="chevron-right" />
                    </s-grid>
                  </s-box>
                </s-clickable>
              ))}
            </s-stack>
          </s-stack>
        </s-section>
      ))}
      <AdminDisclosure label="App permissions and publication checks">
        {denied ? (
          <s-banner tone="critical" heading="Reopen Insignia from Shopify Admin">
            <s-paragraph>{denied}</s-paragraph>
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
      </AdminDisclosure>
    </s-page>
  );
}
