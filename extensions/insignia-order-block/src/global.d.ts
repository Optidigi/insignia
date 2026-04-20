// Type stubs for Shopify Admin extension global API and Polaris web components.
// The actual runtime is provided by the Shopify admin host; these types satisfy tsc.

declare const shopify: {
  data: Record<string, unknown>;
  auth: { idToken(): Promise<string | null> };
  navigate(target: string): void;
};

// Allow all Polaris web component tags (s-*) in Preact JSX without individual declarations.
// Also extend IntrinsicAttributes so `key` is accepted on any custom component.
declare module "preact/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [tag: `s-${string}`]: Record<string, any>;
    }
    interface IntrinsicAttributes {
      key?: string | number | bigint | null;
    }
  }
}
