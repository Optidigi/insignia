import node from '@astrojs/node';
import preact from '@astrojs/preact';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [preact()],
  server: { host: '127.0.0.1' },
});
