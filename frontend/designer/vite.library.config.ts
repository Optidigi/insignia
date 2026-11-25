import { defineConfig } from 'vite';
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist-library',
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'designer', cssFileName: 'designer' },
    rolldownOptions: { external: ['preact', 'preact/hooks', 'preact/jsx-runtime'] },
  },
});
