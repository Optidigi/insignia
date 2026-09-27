import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import preact from '@astrojs/preact';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone', bodySizeLimit: 4096 }),
  integrations: [preact()],
  server: { host: '127.0.0.1' }
});
