export default function SettingsNavigation({
  current,
}: {
  current: 'general' | 'storefront' | 'billing' | 'privacy' | 'methods';
}) {
  const sections = [
    ['general', 'General', '/admin/settings'],
    ['methods', 'Decoration methods', '/admin/settings/methods'],
    ['storefront', 'Storefront setup', '/admin/settings/storefront'],
    ['billing', 'Billing', '/admin/settings/billing'],
    ['privacy', 'Privacy', '/admin/settings/privacy'],
  ] as const;
  return (
    <nav aria-label="Settings sections">
      <s-stack direction="inline" gap="base">
        {sections.map(([id, label, href]) => (
          <s-link key={id} href={href} aria-current={current === id ? 'page' : undefined}>
            {label}
          </s-link>
        ))}
      </s-stack>
    </nav>
  );
}
