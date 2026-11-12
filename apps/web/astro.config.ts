import { fileURLToPath } from 'node:url';
import node from '@astrojs/node';
import preact from '@astrojs/preact';
import { defineConfig } from 'astro/config';

// Middleware mode only disables the adapter's autostart; src/server/entry.ts starts its standalone server and
// reports a failed bind, which the adapter's autostart would drop silently.
const nodeAdapter = node({ mode: 'middleware' });
const serverEntrypoint = fileURLToPath(new URL('./src/server/entry.ts', import.meta.url));

export default defineConfig({
  output: 'server',
  publicDir: '../../frontend/admin/public',
  adapter: {
    ...nodeAdapter,
    hooks: {
      ...nodeAdapter.hooks,
      'astro:config:done': (params) =>
        nodeAdapter.hooks['astro:config:done']?.({
          ...params,
          setAdapter: (adapter) => params.setAdapter({ ...adapter, serverEntrypoint }),
        }),
    },
  },
  integrations: [
    preact(),
    {
      name: 'insignia-polaris-hydration',
      hooks: {
        'astro:config:setup': ({ addClientDirective }) => {
          addClientDirective({
            name: 'polaris',
            entrypoint: fileURLToPath(new URL('../../frontend/admin/src/shared/polaris-hydration.ts', import.meta.url)),
          });
        },
      },
    },
  ],
  server: { host: '127.0.0.1' },
  // Keep compiled page scripts external so the strict script-src policy remains valid.
  vite: { build: { assetsInlineLimit: (filePath) => (filePath.endsWith('.js') ? false : undefined) } },
});
