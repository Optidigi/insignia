// Shopify CLI supplies the existing app credentials and generated preview URL.
// This launches the tested standalone Astro Node bundle, without any Functions.
const port = Number(process.env.PORT);
const missing = [
  !Number.isInteger(port) || port < 1 || port > 65535 ? 'PORT' : '',
  !process.env.APP_URL ? 'APP_URL' : '',
  !process.env.SHOPIFY_API_SECRET ? 'SHOPIFY_API_SECRET' : '',
  process.env.SHOPIFY_API_KEY !== '942e6668fd1177524c0fc48b104b0ac3' ? 'SHOPIFY_API_KEY match' : ''
].filter(Boolean);
if (missing.length) throw new Error(`M0-009 Shopify development environment unavailable: ${missing.join(', ')}`);
process.env.INSIGNIA_M0_009_MODE = 'live';
process.env.INSIGNIA_APP_ORIGIN = process.env.APP_URL;
process.env.HOST = '127.0.0.1';
await import('../dist/server/entry.mjs');
