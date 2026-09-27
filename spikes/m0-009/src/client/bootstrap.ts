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
  const endpoint = protectedContent.dataset.privateEndpoint;
  let request: AbortController | undefined;
  let unmountEditor: (() => void) | undefined;

  const showStatus = (message: string, retry = false) => {
    protectedContent.replaceChildren();
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = message;
    protectedContent.append(status);
    if (retry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Retry';
      button.addEventListener('click', () => void loadProtectedContent(), { once: true });
      protectedContent.append(button);
    }
  };

  const clearProtectedContent = () => {
    request?.abort();
    request = undefined;
    unmountEditor?.();
    unmountEditor = undefined;
    protectedContent.setAttribute('aria-busy', 'true');
    showStatus('Verifying your Shopify Admin session…');
  };

  async function loadProtectedContent() {
    clearProtectedContent();

    // Never use a plain request as a fallback when App Bridge is unavailable.
    if (!('shopify' in window)) {
      protectedContent.setAttribute('aria-busy', 'false');
      showStatus('Open Insignia from Shopify Admin to verify your session.');
      return;
    }
    if (endpoint !== '/private/home' && endpoint !== '/private/draft') {
      protectedContent.setAttribute('aria-busy', 'false');
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
        signal: currentRequest.signal,
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
      protectedContent.innerHTML = html;

      if (endpoint === '/private/draft') {
        const mount = protectedContent.querySelector<HTMLElement>('#draft-editor');
        if (!mount) throw new Error('unavailable');
        const { mountDraftEditor } = await import('../components/DraftEditor');
        if (currentRequest.signal.aborted) return;
        unmountEditor = mountDraftEditor(mount);
      }
      protectedContent.setAttribute('aria-busy', 'false');
    } catch (error) {
      if (currentRequest.signal.aborted) return;
      protectedContent.setAttribute('aria-busy', 'false');
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

  void loadProtectedContent();
  window.addEventListener('pagehide', clearProtectedContent);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void loadProtectedContent();
  });
}
