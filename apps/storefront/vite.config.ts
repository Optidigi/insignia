import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';

// Theme schema JavaScript is classic. Resolve modules beside this asset on the
// theme CDN, never relative to the storefront page's locale/product URL.
// The manual block's Customise button is server-rendered (#653): it is inert until insignia-element.js upgrades its
// <insignia-buyer> (one deferred script plus one ~11 KB import). If that entry cannot load, the button would stay
// dead, so each such button gets the element's existing "Customization unavailable" alert beside it.
const bootstrap = `(()=>{const script=document.currentScript||Array.from(document.scripts).findLast(s=>{try{return new URL(s.src).pathname.endsWith('/insignia-storefront.js')}catch{return false}});if(!script?.src)return;const entry=new URL('insignia-element.js',script.src);void import(entry.href).catch(()=>{for(const buyer of document.querySelectorAll('insignia-buyer:not(:defined)')){if(buyer.querySelector('[data-insignia-unavailable]'))continue;const notice=document.createElement('p');notice.setAttribute('role','alert');notice.setAttribute('data-insignia-unavailable','');notice.textContent='Customization unavailable';buyer.append(notice)}window.dispatchEvent(new CustomEvent('insignia-load-error',{detail:{code:'ASSET_UNAVAILABLE'}}))})})();`;

const fontsourceCss = createRequire(resolve(import.meta.dirname, '../../frontend/designer/package.json')).resolve(
  '@fontsource-variable/inter/index.css',
);
const fontsource = /\/@fontsource-variable\/inter\/index\.css$/;
/** Inter subset faces per font stylesheet; frame-host.ts and frame.tsx load these by name. */
const fontStylesheets = {
  'insignia-designer-font-latin.css': ['latin', 'latin-ext'],
  'insignia-designer-font-other.css': ['greek', 'greek-ext', 'cyrillic', 'cyrillic-ext', 'vietnamese'],
};

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
      // The Designer's Inter faces (≈290 KB as base64) must not block its main stylesheet, and Shopify's CLI only
      // deploys .jpg .jpeg .json .js .css .png .svg .wasm theme assets: no .woff2. The main stylesheet gets no
      // @font-face; two font stylesheets carry the faces base64 (#653). Latin + Latin Extended (every EU language)
      // load with the Designer; Greek, Cyrillic and Vietnamese load without blocking after it opens.
      name: 'insignia-designer-fonts',
      enforce: 'pre',
      load(id) {
        return fontsource.test(id) ? '' : null;
      },
      async generateBundle() {
        const css = await readFile(fontsourceCss, 'utf8');
        const faces = new Map(
          [...css.matchAll(/\/\* inter-([a-z-]+)-wght-normal \*\/\s*(@font-face\s*\{[^}]*\})/g)].map(
            ([, subset = '', face = '']) => [subset, face],
          ),
        );
        const assigned = Object.values(fontStylesheets).flat();
        if (faces.size !== assigned.length || assigned.some((subset) => !faces.has(subset)))
          throw new Error(`Inter subsets changed: ${[...faces.keys()]}`);
        for (const [fileName, subsets] of Object.entries(fontStylesheets)) {
          const rules = await Promise.all(
            subsets.map(async (subset) => {
              const face = faces.get(subset) ?? '';
              const file = /url\(\.\/(files\/[^)]+\.woff2)\)/.exec(face)?.[1];
              if (!file) throw new Error(`Inter ${subset} face has no file`);
              const data = (await readFile(resolve(dirname(fontsourceCss), file))).toString('base64');
              return face.replace(/url\([^)]+\)/, `url(data:font/woff2;base64,${data})`);
            }),
          );
          this.emitFile({ type: 'asset', fileName, source: `${rules.join('\n')}\n` });
        }
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
