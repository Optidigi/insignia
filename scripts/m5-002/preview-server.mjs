// Sole-operator launcher. No secrets, JWTs, request headers/bodies or staff IDs are logged.
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const register = resolve(root, '.m5-002-local/external-register.json');
const lock = openSync(resolve(root, '.m5-002-local/operator.lock'), 'wx', 0o600);
closeSync(lock);
const state = JSON.parse(readFileSync(register, 'utf8'));
if (state.appId !== '429028933633' || state.shop !== 'insignia-rewrite-dev.myshopify.com')
  throw new Error('Operator register target mismatch');
function reserve(kind) {
  if (!Object.hasOwn(state.counts, kind) || state.counts[kind] >= state.limits[kind])
    throw new Error('M5-002 external ceiling reached');
  state.counts[kind]++;
  state.events.push({ kind, at: new Date().toISOString() });
  const descriptor = openSync(register, 'w', 0o600);
  try {
    writeFileSync(descriptor, JSON.stringify(state, null, 2) + '\n');
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}
globalThis.__insigniaM5002Reserve = reserve;
globalThis.__insigniaM5002Observe = (event) =>
  console.log(JSON.stringify({ event: 'm5-002', at: new Date().toISOString(), ...event }));
const base = globalThis.fetch;
let serial = Promise.resolve();
async function guardedFetch(input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.hostname.endsWith('.myshopify.com')) {
    if (url.hostname !== state.shop) throw new Error('Diagnostic external target denied');
    if (url.pathname === '/admin/oauth/access_token') {
      reserve('adminAuth');
      return base(input, { ...init, redirect: 'error' });
    }
    if (url.pathname !== '/admin/api/2026-07/graphql.json') throw new Error('Diagnostic external target denied');
    const body = JSON.parse(String(init?.body ?? ''));
    if (typeof body.query !== 'string' || !/^\s*query\b/.test(body.query) || /\bmutation\b/.test(body.query))
      throw new Error('Diagnostic mutation denied');
    reserve('adminRead');
  } else if (!['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Diagnostic external transport denied');
  return base(input, { ...init, redirect: 'error' });
}
globalThis.fetch = (input, init) => {
  const result = serial.then(() => guardedFetch(input, init));
  serial = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};
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
