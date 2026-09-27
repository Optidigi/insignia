// Document pages contain no private state. App Bridge adds an ID token to these
// same-origin fetches; the server verifies it before returning any fragment.
const protectedContent = document.querySelector<HTMLElement>('[data-private-endpoint]');

// Shopify may provide an ID token in the launch URL. Never propagate it through
// local navigation, browser history, or a referrer from this document.
const launchUrl = new URL(window.location.href);
if (launchUrl.searchParams.has('id_token')) {
  launchUrl.searchParams.delete('id_token');
  window.history.replaceState(window.history.state, '', launchUrl.pathname + launchUrl.search + launchUrl.hash);
}

if (protectedContent) {
  const root = protectedContent;
  const endpoint = protectedContent.dataset.privateEndpoint;
  let request: AbortController | undefined;
  let probe: AbortController | undefined;
  let unmountEditor: (() => void) | undefined;
  let viewer: string | undefined;

  const showStatus = (message: string, retry = false) => {
    root.replaceChildren();
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = message;
    root.append(status);
    if (retry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Retry';
      button.addEventListener('click', () => void loadProtectedContent(), { once: true });
      root.append(button);
    }
  };

  const clearProtectedContent = () => {
    request?.abort();
    request = undefined;
    probe?.abort();
    probe = undefined;
    unmountEditor?.();
    unmountEditor = undefined;
    viewer = undefined;
    root.hidden = false;
    root.inert = false;
    root.setAttribute('aria-busy', 'true');
    showStatus('Verifying your Shopify Admin session…');
  };

  async function loadProtectedContent() {
    clearProtectedContent();

    // Never use a plain request as a fallback when App Bridge is unavailable.
    if (!('shopify' in window)) {
      root.setAttribute('aria-busy', 'false');
      showStatus('Open Insignia from Shopify Admin to verify your session.');
      return;
    }
    if (endpoint !== '/private/home' && endpoint !== '/private/draft') {
      root.setAttribute('aria-busy', 'false');
      showStatus('This page cannot be loaded.');
      return;
    }

    const currentRequest = new AbortController();
    request = currentRequest;
    try {
      const response = await fetch(endpoint, {
        headers: { Accept: 'text/html' },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.any([currentRequest.signal, AbortSignal.timeout(10_000)]),
      });
      if (currentRequest.signal.aborted) return;
      if (response.status === 401) throw new Error('unauthorized');
      if (response.status === 403) throw new Error('forbidden');
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
        throw new Error('unavailable');
      }
      if (new URL(response.url).origin !== window.location.origin) throw new Error('unavailable');

      // This markup comes from the same-origin, token-verified Astro endpoint.
      // Scripts in HTML inserted with innerHTML do not execute.
      const html = await response.text();
      if (currentRequest.signal.aborted) return;
      root.innerHTML = html;
      const nextViewer = root.querySelector('[data-viewer]')?.getAttribute('data-viewer');
      if (!nextViewer || !/^[0-9a-f]{64}$/.test(nextViewer)) throw new Error('unavailable');
      viewer = nextViewer;

      if (endpoint === '/private/draft') {
        const mount = root.querySelector<HTMLElement>('#draft-editor');
        if (!mount) throw new Error('unavailable');
        const { mountDraftEditor } = await import('../components/DraftEditor');
        if (currentRequest.signal.aborted) return;
        unmountEditor = mountDraftEditor(mount);
      }
      root.setAttribute('aria-busy', 'false');
    } catch (error) {
      if (currentRequest.signal.aborted) return;
      viewer = undefined;
      unmountEditor?.();
      unmountEditor = undefined;
      root.setAttribute('aria-busy', 'false');
      const reason = error instanceof Error ? error.message : 'unavailable';
      if (reason === 'unauthorized') {
        showStatus('Your Shopify Admin session could not be verified. Retry from Admin.', true);
      } else if (reason === 'forbidden') {
        showStatus('You do not have permission to view this page.');
      } else {
        showStatus('This page could not be loaded. Retry when your connection is available.', true);
      }
    } finally {
      if (request === currentRequest) request = undefined;
    }
  }

  async function revalidateIdentity() {
    if (document.hidden || !viewer || probe || request ||
        (endpoint !== '/private/home' && endpoint !== '/private/draft')) return;
    if (!('shopify' in window)) { clearProtectedContent(); return; }
    const currentProbe = new AbortController();
    probe = currentProbe;
    // Conceal the previous staff member's fragment until the fresh ID-token
    // request establishes that the viewer is unchanged. Keep the editor mounted
    // for the common same-viewer case, but make it neither visible nor usable.
    root.hidden = true;
    root.inert = true;
    root.setAttribute('aria-busy', 'true');
    let sameViewer = false;
    try {
      const response = await fetch(endpoint, {
        headers: { Accept: 'text/html' }, cache: 'no-store', redirect: 'error',
        signal: AbortSignal.any([currentProbe.signal, AbortSignal.timeout(10_000)])
      });
      if (currentProbe.signal.aborted) return;
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html') ||
          new URL(response.url).origin !== window.location.origin) throw new Error('unavailable');
      const html = await response.text();
      if (currentProbe.signal.aborted) return;
      const nextViewer = new DOMParser().parseFromString(html, 'text/html')
        .querySelector('[data-viewer]')?.getAttribute('data-viewer');
      if (!nextViewer || nextViewer !== viewer) void loadProtectedContent();
      else sameViewer = true;
    } catch {
      if (!currentProbe.signal.aborted) {
        clearProtectedContent();
        root.setAttribute('aria-busy', 'false');
        showStatus('Your Admin session could not be reverified. Retry from Admin.', true);
      }
    } finally {
      if (probe === currentProbe) {
        probe = undefined;
        if (sameViewer) {
          root.hidden = false;
          root.inert = false;
          root.setAttribute('aria-busy', 'false');
        }
      }
    }
  }

  void loadProtectedContent();
  window.addEventListener('pagehide', clearProtectedContent);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void loadProtectedContent();
  });
  document.addEventListener('visibilitychange', () => {
    // Clear synchronously when a hidden Admin tab returns to view; the new
    // App Bridge request establishes the current staff identity before render.
    if (!document.hidden) void loadProtectedContent();
  });
  window.addEventListener('focus', () => void revalidateIdentity());
  window.setInterval(() => void revalidateIdentity(), 15_000);
}
