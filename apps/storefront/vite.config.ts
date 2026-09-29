import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    lib: { entry: resolve(import.meta.dirname, 'src/element.tsx'), formats: ['iife'], name: 'InsigniaLocalPreview', fileName: () => 'insignia-storefront.js' },
    minify: true
  }
});
