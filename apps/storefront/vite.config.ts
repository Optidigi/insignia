import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Theme schema JavaScript is classic. Resolve modules beside this asset on the
// theme CDN, never relative to the storefront page's locale/product URL.
const bootstrap = `(()=>{const script=document.currentScript||Array.from(document.scripts).findLast(s=>{try{return new URL(s.src).pathname.endsWith('/insignia-storefront.js')}catch{return false}});if(!script?.src)return;const entry=new URL('insignia-element.js',script.src);void import(entry.href).catch(()=>{window.dispatchEvent(new CustomEvent('insignia-load-error',{detail:{code:'ASSET_UNAVAILABLE'}}))})})();`;

export default defineConfig({
  plugins: [
    {
      // Library builds inline every asset. The Designer's Inter faces (≈290 KB as base64) would block its
      // stylesheet: emit them as theme assets instead, fetched per unicode-range only when text needs them (#653).
      name: 'insignia-external-fonts',
      enforce: 'pre',
      transform(code, id) {
        if (!/\.css(?:\?.*)?$/.test(id) || !code.includes('.woff2')) return null;
        return { code: code.replace(/(url\(\s*['"]?[^'")?]+\.woff2)(?=['"]?\s*\))/g, '$1?no-inline'), map: null };
      },
    },
    {
      name: 'insignia-theme-bootstrap',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'insignia-storefront.js', source: bootstrap });
      },
    },
  ],
  // Stylesheet asset URLs (the fonts) resolve beside insignia-designer.css on the extension CDN, never against the
  // shop origin or the Designer's about:srcdoc document.
  experimental: {
    renderBuiltUrl: (_filename, { hostType }) => (hostType === 'css' ? { relative: true } : undefined),
  },
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
            : // Stable names: the frame host preloads the Latin face by name; extension asset URLs are versioned.
              asset.names.some((name) => name.endsWith('.woff2'))
              ? 'insignia-font-[name][extname]'
              : 'insignia-[name]-[hash][extname]',
      },
    },
    minify: true,
  },
});
