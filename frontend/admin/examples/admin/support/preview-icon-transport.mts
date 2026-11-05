/** Preview-only icon transport, installed before the unmodified Polaris runtime. */
const root = globalThis;
const originalFetch = root.fetch.bind(root);
const allowedPath = /^\/shopifycloud\/admin-ui-foundations\/(icons|experimental)\/([a-f0-9]{5})\.svg$/;
root.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request ? input : undefined;
  let url: URL;
  try {
    url = new URL(request ? request.url : String(input), root.location.href);
  } catch {
    return originalFetch(input, init);
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'cdn.shopify.com' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  )
    return originalFetch(input, init);
  const match = allowedPath.exec(url.pathname);
  if (!match) return originalFetch(input, init);
  const method = init?.method ?? request?.method ?? 'GET';
  const signal = init?.signal ?? request?.signal;
  return originalFetch(new URL('/__preview/icons/' + match[1] + '/' + match[2] + '.svg', root.location.origin), {
    method,
    credentials: 'omit',
    ...(signal ? { signal } : {}),
  });
};
