/** Full-document routes retain their security boundaries while sharing transition feedback. */
export function installAdminNavigation() {
  let navigating = false;
  let runtimeReady = false;
  let presentationFrame: number | undefined;
  let generation = 0;
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
  function cancelPresentation() {
    generation++;
    if (presentationFrame !== undefined) window.cancelAnimationFrame(presentationFrame);
    presentationFrame = undefined;
  }
  function canReveal() {
    return (
      !navigating &&
      runtimeReady &&
      document.documentElement.dataset.adminLocaleReady !== 'false' &&
      document.documentElement.dataset.adminContentReady === 'true'
    );
  }
  function reveal() {
    if (!canReveal() || presentationFrame !== undefined || document.documentElement.dataset.adminReady === 'true')
      return;
    const pendingGeneration = generation;
    // Let the committed tree and connected custom elements render together.
    // This schedules presentation; it does not promise that optional assets have loaded.
    presentationFrame = window.requestAnimationFrame(() => {
      if (pendingGeneration !== generation) return;
      presentationFrame = undefined;
      if (!canReveal()) return;
      document.documentElement.dataset.adminReady = 'true';
      if (failure) failure.hidden = true;
      if (shell) shell.hidden = false;
      if (content) content.inert = false;
      hostLoading(false);
      document.dispatchEvent(new Event('insignia:admin-revealed'));
    });
  }
  function transition() {
    // Keep the outgoing layout stable. The destination owns its server-rendered skeleton.
    navigating = true;
    cancelPresentation();
    if (content) content.inert = true;
    hostLoading(true);
  }
  document.addEventListener('insignia:admin-ready', reveal);
  document.addEventListener('insignia:admin-locale-ready', reveal);
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
          if (!event.defaultPrevented) transition();
        }, 0);
    },
    true,
  );
  window.addEventListener('pagehide', cancelPresentation);
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    cancelPresentation();
    // Hide the frozen observation before an owner authenticates and revalidates.
    navigating = false;
    document.documentElement.dataset.adminContentReady = 'false';
    document.documentElement.dataset.adminReady = 'false';
    if (content) content.inert = true;
    hostLoading(true);
    // A surviving editor can preserve its exact pending command while reading
    // fresh authority. Routes without that lifecycle owner still reload.
    const resume = new Event('insignia:admin-bfcache-resume', { cancelable: true });
    if (document.dispatchEvent(resume)) location.reload();
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
