import { adminRoute, adminSkeletonDimensions } from './admin-route';

/** Full-document routes retain their security boundaries while sharing transition feedback. */
export function installAdminNavigation() {
  let navigating = false;
  let runtimeReady = false;
  const content = document.getElementById('admin-route-content');
  const shell = document.getElementById('admin-route-skeleton');
  const failure = document.getElementById('admin-route-failure');
  const hostLoading = (value: boolean) => {
    try {
      (window as unknown as { shopify?: { loading?: (active: boolean) => void } }).shopify?.loading?.(value);
    } catch {
      /* Host feedback never grants or blocks application authority. */
    }
  };
  function reveal() {
    if (navigating || !runtimeReady || document.documentElement.dataset.adminContentReady !== 'true') return;
    document.documentElement.dataset.adminReady = 'true';
    if (failure) failure.hidden = true;
    if (shell) shell.hidden = false;
    if (content) content.inert = false;
    hostLoading(false);
  }
  function transition(pathname?: string) {
    if (pathname) {
      const { heading, layout } = adminRoute(pathname);
      const page = shell?.querySelector('[data-skeleton-layout]');
      page?.setAttribute('aria-label', heading);
      page?.setAttribute('data-skeleton-layout', layout);
      const preview = shell?.querySelector<HTMLElement>('[data-skeleton-preview]');
      if (preview) {
        preview.hidden = layout !== 'editor';
        if (layout === 'editor') preview.setAttribute('slot', 'aside');
        else preview.removeAttribute('slot');
      }
      const placeholders = shell?.querySelector('[aria-label="Page content"]');
      if (placeholders) {
        const variant = layout === 'editor' ? 'form' : layout;
        placeholders.className = `admin-skeleton admin-skeleton-${variant}`;
        const dimensions = adminSkeletonDimensions(variant);
        for (const part of ['leading', 'label', 'value'] as const)
          for (const box of placeholders.querySelectorAll(`[data-skeleton-part="${part}"]`))
            Object.assign(box, dimensions[part]);
      }
    }
    navigating = true;
    document.documentElement.dataset.adminReady = 'false';
    if (content) content.inert = true;
    hostLoading(true);
  }
  document.addEventListener('insignia:admin-ready', reveal);
  document.addEventListener(
    'click',
    (event) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.defaultPrevented
      )
        return;
      const link = event
        .composedPath()
        .find((node) => node instanceof Element && node.matches('s-link[href],s-button[href],s-clickable[href]')) as
        | Element
        | undefined;
      if (!link || link.getAttribute('target') === '_blank' || link.hasAttribute('download')) return;
      const url = new URL(link.getAttribute('href') ?? '', location.href);
      if (
        url.origin === location.origin &&
        url.pathname.startsWith('/admin/') &&
        (url.pathname !== location.pathname || url.search !== location.search)
      )
        window.setTimeout(() => {
          if (!event.defaultPrevented) transition(url.pathname);
        }, 0);
    },
    true,
  );
  window.addEventListener('beforeunload', () => transition());
  window.addEventListener('pageshow', (event) => {
    // Revalidate authenticated data when returning from a frozen document.
    if (event.persisted) location.reload();
  });
  // Declarative children such as s-option are not independently defined elements.
  // The page definition is the pinned runtime's bootstrap boundary.
  customElements.whenDefined('s-page').then(() => {
    runtimeReady = true;
    reveal();
  });
  window.setTimeout(() => {
    if (document.documentElement.dataset.adminReady === 'true' || navigating) return;
    if (shell) shell.hidden = true;
    if (failure) failure.hidden = false;
    hostLoading(false);
  }, 15000);
}
