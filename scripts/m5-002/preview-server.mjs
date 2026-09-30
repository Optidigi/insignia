// Sole-operator launcher. No secrets, JWTs, request headers/bodies or staff IDs are logged.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPreviewOperator } from './read-register.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const operator = createPreviewOperator({ directory: resolve(root, '.m5-002-local') });
const state = operator.state;
globalThis.__insigniaM5002Reserve = operator.reserve;
globalThis.__insigniaM5002Observe = (event) =>
  console.log(JSON.stringify({ event: 'm5-002', at: new Date().toISOString(), ...event }));
globalThis.fetch = operator.fetch;
if (process.env.SHOPIFY_API_KEY !== state.clientId || !process.env.SHOPIFY_API_SECRET)
  throw new Error('Preview CLI identity incomplete');
process.env.SHOPIFY_CLIENT_ID = process.env.SHOPIFY_API_KEY;
process.env.SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_API_SECRET;
process.env.INSIGNIA_M5_002_DIAGNOSTIC = '1';
process.env.INSIGNIA_M5_002_SHOP = state.shop;
process.env.INSIGNIA_M5_002_SHOP_ID = 'gid://shopify/Shop/105501393179';
process.env.INSIGNIA_M5_002_PRODUCT_ID = 'gid://shopify/Product/10485042479387';
process.env.HOST = '127.0.0.1';
process.env.DATABASE_URL = 'postgresql://insignia_test@127.0.0.1:55432/insignia_m5002_diagnostic?sslmode=disable';
await import('../../apps/web/dist/server/entry.mjs');
