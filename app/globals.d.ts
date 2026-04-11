declare module "*.css";

declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string);
    window: Window & typeof globalThis;
  }
}

// Shopify App Bridge web components (App Bridge registers these as custom elements)
declare namespace React.JSX {
  interface IntrinsicElements {
    "ui-save-bar": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      id?: string;
    };
  }
}

// Shopify App Bridge global — extends native Window (ambient declaration, no import/export needed)
interface ShopifyAppBridge {
  saveBar?: {
    show: (id: string) => void;
    hide: (id: string) => void;
  };
  toast?: {
    show: (message: string, options?: { duration?: number; isError?: boolean }) => void;
  };
  resourcePicker?: (options: {
    type: string;
    multiple?: boolean;
    action?: string;
    selectionIds?: Array<{ id: string }>;
    query?: string;
  }) => Promise<Array<{ id: string; title: string } & Record<string, unknown>>>;
}

// Extend the global Window interface (valid in ambient .d.ts files without module syntax)
interface Window {
  shopify?: ShopifyAppBridge;
  Shopify?: {
    routes?: { root?: string };
  };
}
