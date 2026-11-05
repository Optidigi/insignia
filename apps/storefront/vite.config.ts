import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Theme schema JavaScript is classic. Resolve modules beside this asset on the
// theme CDN, never relative to the storefront page's locale/product URL.
const bootstrap = `(()=>{const script=document.currentScript||Array.from(document.scripts).findLast(s=>{try{return new URL(s.src).pathname.endsWith('/insignia-storefront.js')}catch{return false}});if(!script?.src)return;const entry=new URL('insignia-element.js',script.src);void import(entry.href).catch(()=>{window.dispatchEvent(new CustomEvent('insignia-load-error',{detail:{code:'ASSET_UNAVAILABLE'}}))})})();`;

export default defineConfig({
  plugins: [
    {
      name: 'insignia-theme-bootstrap',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'insignia-storefront.js', source: bootstrap });
      },
    },
  ],
  build: {
    lib: {
      entry: {
        element: resolve(import.meta.dirname, 'src/element.tsx'),
        designer: resolve(import.meta.dirname, 'src/designer/frame.tsx'),
      },
      formats: ['es'],
      fileName: (_format, name) => (name === 'designer' ? 'insignia-designer-frame.js' : 'insignia-element.js'),
      cssFileName: 'insignia-designer',
    },
    rolldownOptions: {
      output: {
        chunkFileNames: 'insignia-[name]-[hash].js',
        assetFileNames: (asset) =>
          asset.names.some((name) => name.endsWith('.css'))
            ? 'insignia-designer.css'
            : 'insignia-[name]-[hash][extname]',
      },
    },
    minify: true,
  },
});
