import { useLayoutEffect } from 'preact/hooks';

/** Release the initial route shell after its authenticated read settles, including errors. */
export function useAdminPageReady(ready: boolean) {
  useLayoutEffect(() => {
    if (!ready) return;
    let active = true;
    let queued = false;
    let frame: number | undefined;
    const bridge = (window as unknown as { shopify?: { ready?: Promise<unknown> } }).shopify;
    const exportHeading = () => {
      if (queued || !bridge?.ready) return;
      queued = true;
      void bridge.ready.then(() => {
        if (!active) return;
        frame = requestAnimationFrame(() => {
          if (!active) return;
          const page = document.querySelector('s-page[heading]');
          const heading = page?.getAttribute('heading');
          // Bridge can observe the initial page while the route is still inert.
          // Re-export the same metadata only after reveal and host readiness.
          if (page && heading !== null && heading !== undefined) page.setAttribute('heading', heading);
        });
      }).catch(() => {});
    };
    document.addEventListener('insignia:admin-revealed', exportHeading);
    document.documentElement.dataset.adminContentReady = 'true';
    document.dispatchEvent(new Event('insignia:admin-ready'));
    if (document.documentElement.dataset.adminReady === 'true') exportHeading();
    return () => {
      active = false;
      document.removeEventListener('insignia:admin-revealed', exportHeading);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [ready]);
}
