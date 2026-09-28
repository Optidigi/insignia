// This launcher is only for the new Optidigi public app and its dedicated dev
// store. Shopify CLI supplies its secret to this child process at preview time.
import { readFileSync } from 'node:fs';

const client = '1443cf6d03d39edae7c101a943c5c684';
let builtClient;
try { builtClient = readFileSync(new URL('../dist/build-client-id', import.meta.url), 'utf8').trim(); }
catch { /* The explicit preflight below rejects an absent build marker. */ }
let appUrl;
try { appUrl = new URL(process.env.APP_URL); }
catch { /* The explicit preflight below rejects an invalid URL. */ }
const controlledHttps = appUrl?.protocol === 'https:' && appUrl.hostname !== 'example.com' &&
  !appUrl.username && !appUrl.password && appUrl.pathname === '/' && !appUrl.search && !appUrl.hash;
const port = Number(process.env.PORT);
const missing = [
  !Number.isInteger(port) || port < 1 || port > 65535 ? 'PORT' : '',
  !controlledHttps ? 'controlled HTTPS APP_URL' : '',
  !process.env.SHOPIFY_API_SECRET ? 'SHOPIFY_API_SECRET' : '',
  process.env.SHOPIFY_API_KEY !== client ? 'SHOPIFY_API_KEY match' : '',
  builtClient !== client ? 'build/client match' : ''
].filter(Boolean);
if (missing.length) throw new Error(`Insignia public preview environment unavailable: ${missing.join(', ')}`);
process.env.INSIGNIA_M0_009_MODE = 'public-bootstrap';
process.env.INSIGNIA_APP_ORIGIN = process.env.APP_URL;
process.env.HOST = '127.0.0.1';
await import('../dist/server/entry.mjs');
