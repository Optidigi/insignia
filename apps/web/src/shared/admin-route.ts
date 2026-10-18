/** Presentation only; route security and authenticated reads remain with each page. */
export type AdminSkeletonVariant = 'table' | 'form' | 'detail' | 'settings' | 'preview' | 'inline';
export function adminSkeletonDimensions(variant: AdminSkeletonVariant) {
  return {
    leading: {
      inlineSize: variant === 'preview' ? '100%' : '72px',
      blockSize: variant === 'preview' ? '420px' : '56px',
    },
    label: { inlineSize: variant === 'form' ? '40%' : '65%', blockSize: '16px' },
    value: { inlineSize: variant === 'form' ? '100%' : '90%', blockSize: variant === 'form' ? '36px' : '12px' },
  } as const;
}

export function adminRoute(pathname: string) {
  if (/^\/admin\/products\/[^/]+\/config\/?$/.test(pathname))
    return { heading: 'Customize product', layout: 'editor' } as const;
  if (/^\/admin\/orders\/[^/]+\/?$/.test(pathname)) return { heading: 'Order and artwork', layout: 'detail' } as const;
  switch (pathname.replace(/\/$/, '')) {
    case '/admin/products':
      return { heading: 'Products', layout: 'table' } as const;
    case '/admin/orders':
      return { heading: 'Orders and artwork', layout: 'table' } as const;
    case '/admin/settings/methods':
      return { heading: 'Decoration method library', layout: 'form' } as const;
    case '/admin/settings/storefront':
      return { heading: 'Storefront setup', layout: 'detail' } as const;
    case '/admin/settings/billing':
      return { heading: 'Billing', layout: 'detail' } as const;
    case '/admin/settings/privacy':
      return { heading: 'Customer privacy requests', layout: 'table' } as const;
    default:
      return { heading: 'Settings', layout: 'settings' } as const;
  }
}
