/** Presentation only; route security and authenticated reads remain with each page. */
export type AdminSkeletonVariant = 'table' | 'form' | 'detail' | 'settings' | 'preview' | 'inline';
export function adminSkeletonDimensions(variant: AdminSkeletonVariant) {
  return {
    leading: {
      inlineSize: variant === 'preview' ? '100%' : '40px',
      blockSize: variant === 'preview' ? '360px' : '40px',
    },
    label: { inlineSize: variant === 'form' ? '40%' : '65%', blockSize: '16px' },
    value: { inlineSize: variant === 'form' ? '100%' : '90%', blockSize: variant === 'form' ? '36px' : '12px' },
  } as const;
}

export function adminRoute(pathname: string) {
  if (/^\/admin\/products\/[^/]+\/config\/?$/.test(pathname))
    return { heading: 'Customize product', layout: 'editor', inlineSize: 'base' } as const;
  if (/^\/admin\/orders\/[^/]+\/?$/.test(pathname))
    return { heading: 'Order and artwork', layout: 'detail', inlineSize: 'base' } as const;
  switch (pathname.replace(/\/$/, '')) {
    case '/admin/products':
      return { heading: 'Products', layout: 'table', inlineSize: 'base' } as const;
    case '/admin/orders':
      return { heading: 'Orders and artwork', layout: 'table', inlineSize: 'base' } as const;
    case '/admin/settings/methods':
      return { heading: 'Decoration method library', layout: 'form', inlineSize: 'base' } as const;
    case '/admin/settings/storefront':
      return { heading: 'Storefront setup', layout: 'detail', inlineSize: 'small' } as const;
    case '/admin/settings/billing':
      return { heading: 'Billing', layout: 'detail', inlineSize: 'small' } as const;
    case '/admin/settings/privacy':
      return { heading: 'Customer privacy requests', layout: 'table', inlineSize: 'base' } as const;
    default:
      return { heading: 'Settings', layout: 'settings', inlineSize: 'small' } as const;
  }
}
