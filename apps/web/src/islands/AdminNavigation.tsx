type Area = 'products' | 'orders' | 'billing';
const destinations: { area: Area; href: string; label: string }[] = [
  { area: 'products', href: '/admin/products', label: 'Products' },
  { area: 'orders', href: '/admin/orders', label: 'Orders and artwork' },
  { area: 'billing', href: '/admin/billing', label: 'Billing' },
];

export default function AdminNavigation({ current }: { current: Area }) {
  return (
    <nav class="admin-navigation" aria-label="Insignia">
      {destinations.map(({ area, href, label }) => (
        <s-link key={area} href={href} aria-current={area === current ? 'page' : undefined}>
          {label}
        </s-link>
      ))}
    </nav>
  );
}
