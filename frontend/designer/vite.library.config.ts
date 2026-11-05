import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    outDir: 'dist-library',
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'designer', cssFileName: 'designer' },
    rollupOptions: { external: ['preact', 'preact/hooks', 'preact/jsx-runtime'] },
  },
});
