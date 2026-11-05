import { fileURLToPath } from 'node:url';
import node from '@astrojs/node';
import preact from '@astrojs/preact';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  publicDir: '../../frontend/admin/public',
  adapter: node({ mode: 'standalone' }),
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
