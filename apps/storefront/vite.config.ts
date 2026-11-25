import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Theme schema JavaScript is classic. Resolve modules beside this asset on the
// theme CDN, never relative to the storefront page's locale/product URL.
const bootstrap = `(()=>{const script=document.currentScript||Array.from(document.scripts).findLast(s=>{try{return new URL(s.src).pathname.endsWith('/insignia-storefront.js')}catch{return false}});if(!script?.src)return;const entry=new URL('insignia-element.js',script.src);void import(entry.href).catch(()=>{window.dispatchEvent(new CustomEvent('insignia-load-error',{detail:{code:'ASSET_UNAVAILABLE'}}))})})();`;

/** Modules the element imports to open the Designer, besides the frame entry. */
const openPathModules = [
  '/src/designer/modal.ts',
  '/src/buyer.ts',
  '/src/designer/controller.ts',
  '/src/designer/frame-host.ts',
];

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
      // The Designer's open path is a chain of dynamic imports (element → modal/buyer/controller → their static
      // imports, then the frame entry in its iframe). Write the whole chunk set into the element so intent or a
      // click can fetch it in parallel (#653). Taken from this build's graph, never maintained by hand.
      name: 'insignia-open-path-chunks',
      generateBundle(_options, bundle) {
        const chunks = new Map(
          Object.values(bundle)
            .filter((item) => item.type === 'chunk')
            .map((chunk) => [chunk.fileName, chunk]),
        );
        const closure = (roots: string[]) => {
          const seen = new Set<string>();
          const visit = (fileName: string) => {
            if (seen.has(fileName)) return;
            seen.add(fileName);
            for (const imported of chunks.get(fileName)?.imports ?? []) visit(imported);
          };
          for (const root of roots) visit(root);
          return seen;
        };
        const roots = [...chunks.values()]
          .filter(
            (chunk) =>
              chunk.fileName === 'insignia-designer-frame.js' ||
              openPathModules.some((path) => chunk.moduleIds.some((id) => id.endsWith(path))),
          )
          .map((chunk) => chunk.fileName);
        for (const path of openPathModules)
          if (![...chunks.values()].some((chunk) => chunk.moduleIds.some((id) => id.endsWith(path))))
            throw new Error(`Open path module not built: ${path}`);
        const eager = closure(['insignia-element.js']);
        const files = [...closure(roots)].filter((fileName) => !eager.has(fileName)).sort();
        const element = chunks.get('insignia-element.js');
        const list = JSON.stringify(JSON.stringify(files));
        // A build given this config object also loads this file, so the hook can run twice on one bundle.
        if (element?.code.includes(list)) return;
        const token = /(["'])__INSIGNIA_OPEN_PATH_CHUNKS__\1/g;
        if (!element || element.code.match(token)?.length !== 1) throw new Error('Open path placeholder not found');
        element.code = element.code.replace(token, list);
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
