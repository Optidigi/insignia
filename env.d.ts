/// <reference types="vite/client" />
/// <reference types="@react-router/node" />

interface Window {
  shopify?: {
    toast?: { show: (message: string, options?: { duration?: number; isError?: boolean }) => void };
    resourcePicker?: (...args: unknown[]) => Promise<Array<{ id: string; title: string; [key: string]: unknown }> | null>;
  };
}
