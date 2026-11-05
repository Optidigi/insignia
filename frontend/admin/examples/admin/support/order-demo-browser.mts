/** Development controls stay outside the actual merchant UI. */
const frame = document.querySelector<HTMLIFrameElement>('iframe[data-demo-src]');
const message = document.querySelector('[data-demo-message]');
const reset = document.querySelector<HTMLElementTagNameMap['s-button']>('[data-demo-reset]');
const picker = document.querySelector<HTMLElementTagNameMap['s-select']>('[data-demo-order]');
const startPath = frame?.dataset.demoSrc;
const placementExampleStorageKey = 'insignia-placement-example';
const placementExampleGuardMessage = 'Save or discard your changes before changing the example.';
const placementDraftObserver = new MutationObserver(() => clearResolvedPlacementGuard());
let activePlacementExample = 'configured';
let placementGuardPending = false;

function setMessage(text: string) {
  if (message) message.textContent = text;
}

function syncPlacementExample() {
  try {
    activePlacementExample = frame?.contentWindow
      ? (new URLSearchParams(frame.contentWindow.location.search).get('__variant_example') ??
        frame.contentWindow.sessionStorage.getItem(placementExampleStorageKey) ??
        'configured')
      : 'configured';
  } catch {
    /* Optional storage. */
  }
  if (placementExample) placementExample.value = activePlacementExample;
}

function hasUnsavedPlacementDraft() {
  const saveDraft =
    frame?.contentDocument?.querySelector<HTMLElementTagNameMap['s-button']>('[data-editor-save-draft]');
  return !!saveDraft && !saveDraft.disabled;
}

function clearResolvedPlacementGuard() {
  if (!placementGuardPending || hasUnsavedPlacementDraft()) return;
  placementGuardPending = false;
  setMessage('Local demo');
}

function observePlacementDraft() {
  placementDraftObserver.disconnect();
  const root = frame?.contentDocument?.documentElement;
  if (!root) return;
  placementDraftObserver.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['disabled'],
  });
  clearResolvedPlacementGuard();
}

frame?.addEventListener('load', () => {
  const pathname = frame.contentWindow?.location.pathname;
  if (picker) picker.value = pathname?.startsWith('/admin/orders') ? pathname : 'none';
  syncPlacementExample();
  observePlacementDraft();
});
picker?.addEventListener('change', () => {
  if (frame?.contentDocument?.querySelector('s-modal[data-method-dialog]')) return;
  const path = picker.value;
  const currentPath = frame?.contentWindow?.location.pathname;
  picker.value = currentPath?.startsWith('/admin/orders') ? currentPath : 'none';
  if (frame && typeof path === 'string' && /^\/admin\/orders(?:\/[0-9a-f-]+)?$/.test(path))
    document.dispatchEvent(new CustomEvent('insignia:preview-navigate', { detail: path }));
});
const methodCatalog = document.querySelector<HTMLElementTagNameMap['s-select']>('[data-method-catalog]');
const placementExample = document.querySelector<HTMLElementTagNameMap['s-select']>('[data-placement-example]');
placementExample?.addEventListener('change', () => {
  if (!frame?.contentWindow || frame.contentDocument?.querySelector('s-modal[data-method-dialog]')) return;
  if (
    hasUnsavedPlacementDraft() ||
    !frame.contentWindow.dispatchEvent(new Event('beforeunload', { cancelable: true }))
  ) {
    placementExample.value = activePlacementExample;
    placementGuardPending = true;
    setMessage(placementExampleGuardMessage);
    return;
  }
  try {
    const nextExample = placementExample.value ?? activePlacementExample;
    frame.contentWindow.sessionStorage.setItem(placementExampleStorageKey, nextExample);
    activePlacementExample = nextExample;
    placementGuardPending = false;
    setMessage('Local demo');
    const destination = new URL(frame.contentWindow.location.href);
    destination.searchParams.delete('__variant_example');
    frame.contentWindow.location.assign(destination.href);
  } catch {
    placementExample.value = activePlacementExample;
    setMessage('Allow browser storage to switch examples.');
  }
});
methodCatalog?.addEventListener('change', () => {
  if (!frame?.contentWindow) return;
  if (frame.contentDocument?.querySelector('s-modal[data-method-dialog]')) return;
  if (!frame.contentWindow.dispatchEvent(new Event('beforeunload', { cancelable: true }))) {
    try {
      methodCatalog.value =
        frame.contentWindow.sessionStorage.getItem('insignia-method-catalog') === 'large' ? 'large' : 'small';
    } catch {
      /* Optional browser storage may be disabled. */
    }
    if (message) message.textContent = 'Save or discard your changes before changing the catalog.';
    return;
  }
  try {
    frame.contentWindow.sessionStorage.setItem(
      'insignia-method-catalog',
      methodCatalog.value === 'large' ? 'large' : 'small',
    );
    if (message) message.textContent = 'Local demo';
    frame.contentWindow.location.assign('/admin/methods');
  } catch {
    if (message) message.textContent = 'The catalog could not be changed. Allow browser storage and try again.';
  }
});
async function start() {
  if (!frame || !startPath) return;
  try {
    await navigator.serviceWorker.register('/__preview/demo/worker.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }),
      );
    frame.src = startPath;
    if (message) message.textContent = 'Local demo';
  } catch {
    if (message) message.textContent = 'Could not start the local demo. Reload to try again.';
  }
}
reset?.addEventListener('click', async () => {
  if (frame?.contentDocument?.querySelector('s-modal[data-method-dialog]')) return;
  // Reuse the app's existing unsaved/uncertain-write guard before resetting local fixtures.
  if (frame?.contentWindow?.dispatchEvent(new Event('beforeunload', { cancelable: true })) === false) {
    if (message) message.textContent = 'Save or discard your changes before resetting the demo.';
    return;
  }
  reset.loading = true;
  try {
    const response = await fetch('/__preview/demo/reset', { method: 'POST' });
    if (!response.ok) throw new Error('Reset failed');
    try {
      frame?.contentWindow?.sessionStorage.removeItem('insignia-methods-preview-v1');
      frame?.contentWindow?.sessionStorage.removeItem('insignia-methods-preview-large-v1');
      const storage = frame?.contentWindow?.sessionStorage;
      if (storage)
        for (const key of Object.keys(storage))
          if (key.startsWith('insignia-placement-preview-') || key.startsWith('insignia-placement-copy-report-'))
            storage.removeItem(key);
    } catch {
      /* Optional preview storage may be disabled. */
    }
    const pathname = frame?.contentWindow?.location.pathname;
    if (frame && startPath) frame.src = pathname?.startsWith('/admin/') ? pathname : startPath;
    if (message) message.textContent = 'Demo reset';
  } catch {
    if (message) message.textContent = 'Could not reset the order. Try again.';
  } finally {
    reset.loading = false;
  }
});
void start();
