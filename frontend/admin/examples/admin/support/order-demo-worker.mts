/** Map the reserved demo asset origin to loopback without changing production HTTPS contracts. */
const worker = globalThis as unknown as {
  location: Location;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(
    type: 'install' | 'activate',
    listener: (event: { waitUntil(promise: Promise<unknown>): void }) => void,
  ): void;
  addEventListener(
    type: 'fetch',
    listener: (event: { request: Request; respondWith(response: Promise<Response>): void }) => void,
  ): void;
};
worker.addEventListener('install', (event) => event.waitUntil(worker.skipWaiting()));
worker.addEventListener('activate', (event) => event.waitUntil(worker.clients.claim()));
worker.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== 'https://insignia-order-demo.invalid') return;
  if (!/^\/(files\/[a-z0-9-]+\.(jpg|png|svg)|asset\/[0-9a-f-]+\/(preview|download))$/.test(url.pathname)) {
    event.respondWith(Promise.resolve(new Response('Unknown demo image', { status: 404 })));
    return;
  }
  event.respondWith(
    fetch(new URL(`/__preview/demo${url.pathname}`, worker.location.origin), {
      credentials: 'omit',
      redirect: 'error',
    }),
  );
});
