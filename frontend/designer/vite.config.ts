import { defineConfig } from 'vite';

// Vite 8 transforms with Oxc, which applies tsconfig JSX settings only to files that tsconfig.json includes.
// The browser-check fixtures under scripts/ are outside it, so the Preact JSX runtime is stated here for every file,
// for both the transform and the dependency scan.
const jsx = { runtime: 'automatic', importSource: 'preact' } as const;
export default defineConfig({
  oxc: { jsx },
  optimizeDeps: { rolldownOptions: { transform: { jsx } } },
});
