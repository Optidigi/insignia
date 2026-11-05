import { useLayoutEffect } from 'preact/hooks';

/** Release the initial route shell after its authenticated read settles, including errors. */
export function useAdminPageReady(ready: boolean) {
  useLayoutEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.adminContentReady = 'true';
    document.dispatchEvent(new Event('insignia:admin-ready'));
  }, [ready]);
}
