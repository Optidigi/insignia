import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { CustomizationFxProvider } from '../../application/src/pricing/customization-fx.ts';
import { OpenExchangeRatesError, OpenExchangeRatesProvider } from '../src/open-exchange-rates.ts';

const request = { shopId: 'shop', installationGeneration: '3', shopCurrency: 'EUR', presentmentCurrency: 'USD' };
const body = '{"base":"EUR","timestamp":1780000000,"rates":{"USD":1.100000000000000001}}';
const clock = () => new Date(1780000030000);
function provider(reply = (_url: string) => new Response(body, { status: 200 })) {
  return new OpenExchangeRatesProvider({
    appId: 'synthetic-app-id',
    fetcher: async (url, _init) => reply(url),
    clock,
    maxAgeMs: 60000,
  });
}
test('exact OXR rate and publication timestamp survive synthetic HTTP', async () => {
  let requested = '';
  const p = provider((url) => {
    requested = url;
    return new Response(body, { status: 200 });
  });
  const port: CustomizationFxProvider = p;
  const got = await port.resolve(request);
  assert.equal(
    requested,
    'https://openexchangerates.org/api/latest.json?app_id=synthetic-app-id&base=EUR&symbols=USD&prettyprint=0',
  );
  assert.equal(got.rateDecimal, '1.100000000000000001');
  assert.equal(got.effectiveAt, '2026-05-28T20:26:40.000Z');
  assert.equal(got.shopId, 'shop');
  assert.equal(got.source, 'openexchangerates');
});
test('OXR fails closed on base, pair, freshness, numeric shape and status', async () => {
  for (const payload of [
    body.replace('"EUR"', '"USD"'),
    body.replace('"USD":', '"JPY":'),
    body.replace('1.100000000000000001', '0'),
    body.replace('1.100000000000000001', '-1'),
    body.replace('1.100000000000000001', '1e999'),
    body.replace('1780000000', '1779990000'),
    body.replace('"USD":1.100000000000000001', '"USD":1,"USD":2'),
  ])
    await assert.rejects(provider(() => new Response(payload)).resolve(request), OpenExchangeRatesError);
  for (const status of [301, 401, 429, 500])
    await assert.rejects(
      provider(() => new Response('', { status, headers: { location: 'https://evil.test/' } })).resolve(request),
      OpenExchangeRatesError,
    );
});
test('OXR classifies transport and bounded-body failures', async () => {
  for (const [status, reason] of [
    [301, 'redirect'],
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limited'],
    [503, 'provider'],
  ] as const) {
    await assert.rejects(
      provider(() => new Response('', { status })).resolve(request),
      (e: unknown) => e instanceof OpenExchangeRatesError && e.reason === reason,
    );
  }
  await assert.rejects(
    new OpenExchangeRatesProvider({
      appId: 'synthetic-app-id',
      fetcher: async () => {
        throw Error('offline');
      },
      clock,
      maxAgeMs: 60000,
    }).resolve(request),
    (e: unknown) => e instanceof OpenExchangeRatesError && e.reason === 'network',
  );
  await assert.rejects(
    provider(() => new Response('x'.repeat(70000))).resolve(request),
    (e: unknown) => e instanceof OpenExchangeRatesError && e.reason === 'malformed',
  );
  const redirected = new Response(body);
  Object.defineProperty(redirected, 'url', { value: 'https://evil.example/api/latest.json' });
  await assert.rejects(
    provider(() => redirected).resolve(request),
    (e: unknown) => e instanceof OpenExchangeRatesError && e.reason === 'redirect',
  );
});
test('scientific JSON rate expands exactly and same currency cannot invoke FX', async () => {
  const got = await provider(() => new Response(body.replace('1.100000000000000001', '1.23e-3'))).resolve(request);
  assert.equal(got.rateDecimal, '0.00123');
  await assert.rejects(
    provider().resolve({ ...request, presentmentCurrency: 'EUR' }),
    (e: unknown) => e instanceof OpenExchangeRatesError && e.reason === 'configuration',
  );
});
test('OXR enforces a finite request timeout without retry or fallback', async () => {
  const stalled = new OpenExchangeRatesProvider({
    appId: 'synthetic-app-id',
    fetcher: async () => new Promise<Response>(() => {}),
    clock,
    maxAgeMs: 60000,
    timeoutMs: 5,
  });
  await assert.rejects(
    stalled.resolve(request),
    (error: unknown) => error instanceof OpenExchangeRatesError && error.reason === 'network',
  );
});
test('OXR distinguishes wrong base, missing pair and expired publication', async () => {
  const cases = [
    [body.replace('"EUR"', '"USD"'), 'wrong_base'],
    [body.replace('"USD":', '"JPY":'), 'missing_pair'],
    [body.replace('1780000000', '1779990000'), 'stale'],
  ] as const;
  for (const [payload, reason] of cases) {
    await assert.rejects(
      provider(() => new Response(payload)).resolve(request),
      (error: unknown) => error instanceof OpenExchangeRatesError && error.reason === reason,
    );
  }
});
