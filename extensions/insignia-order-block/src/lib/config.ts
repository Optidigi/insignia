// App server base URL — injected from SHOPIFY_APP_URL env var by the Shopify CLI
// bundler at build time, with the production URL as the fallback.
export const APP_URL =
  (typeof process !== "undefined" && process.env?.SHOPIFY_APP_URL) ||
  "https://insignia.optidigi.nl";
