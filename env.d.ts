/// <reference types="vite/client" />
/// <reference types="@react-router/node" />

interface Window {
  shopify?: {
    toast?: { show: (message: string, options?: { duration?: number; isError?: boolean }) => void };
    resourcePicker?: (...args: unknown[]) => Promise<Array<{ id: string; title: string; [key: string]: unknown }> | null>;
    saveBar?: {
      show: (id: string) => void;
      hide: (id: string) => void;
      toggle: (id: string) => void;
      leaveConfirmation: () => void;
    };
    modal?: {
      show: (id: string) => void;
      hide: (id: string) => void;
      toggle: (id: string) => void;
    };
  };
}

// Allow all Polaris web component tags (s-*) in React JSX without individual declarations.
// The extension's global.d.ts covers Preact JSX; this covers the root React tsconfig.
declare namespace React {
  namespace JSX {
    interface IntrinsicElements {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [tag: `s-${string}`]: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, any>;
    }
  }
}
