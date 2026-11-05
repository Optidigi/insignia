import { type AdminTranslator, createAdminTranslator } from '@insignia/ui-localization/admin';
/** Presentation only; route security and authenticated reads remain with each page. */
export type AdminSkeletonVariant = 'table' | 'form' | 'detail' | 'settings' | 'translations' | 'preview' | 'inline';
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

export function adminRoute(pathname: string, t: AdminTranslator = createAdminTranslator().t) {
  if (/^\/admin\/products\/[^/]+\/config\/?$/.test(pathname))
    return { heading: t('admin-shell:routes.customizeProduct'), layout: 'editor', inlineSize: 'large' } as const;
  if (/^\/admin\/orders\/[^/]+\/?$/.test(pathname))
    return { heading: t('admin-shell:routes.orderArtwork'), layout: 'detail', inlineSize: 'base' } as const;
  switch (pathname.replace(/\/$/, '')) {
    case '/admin/home':
      return { heading: t('admin-shell:routes.home'), layout: 'detail', inlineSize: 'base' } as const;
    case '/admin/products':
      return { heading: t('admin-shell:routes.products'), layout: 'table', inlineSize: 'large' } as const;
    case '/admin/orders':
      return { heading: t('admin-shell:routes.orders'), layout: 'table', inlineSize: 'large' } as const;
    case '/admin/settings/permissions':
      return { heading: t('admin-shell:routes.permissions'), layout: 'permissions', inlineSize: 'small' } as const;
    case '/admin/methods':
    case '/admin/settings/methods':
      return { heading: t('admin-shell:routes.methods'), layout: 'methods', inlineSize: 'large' } as const;
    case '/admin/settings/storefront':
      return { heading: t('admin-shell:routes.storefront'), layout: 'storefront', inlineSize: 'small' } as const;
    case '/admin/settings/translations':
      return { heading: t('admin-shell:titles.translations'), layout: 'translations', inlineSize: 'large' } as const;
    case '/admin/settings/billing':
      return { heading: t('admin-shell:routes.billing'), layout: 'billing', inlineSize: 'small' } as const;
    default:
      return { heading: t('admin-shell:routes.settings'), layout: 'settings', inlineSize: 'small' } as const;
  }
}

export function adminSkeletonInlineSize(inlineSize: ReturnType<typeof adminRoute>['inlineSize']) {
  return inlineSize === 'large' ? '100%' : inlineSize === 'small' ? '848px' : '1030px';
}
