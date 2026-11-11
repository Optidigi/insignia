import assert from 'node:assert/strict';
import test from 'node:test';
import { createVisitorKey, visitorAddress } from '../src/server/buyer/visitor-address.ts';

const request = (chain?: string, extra: Record<string, string> = {}) =>
  new Request('https://app.insigniacustomizer.com/api/artwork/v1/sessions', {
    method: 'POST',
    headers: { ...(chain === undefined ? {} : { 'x-insignia-client-chain': chain }), ...extra },
  });

test('the limit uses only the last entry of the Cloudflare client chain', () => {
  assert.equal(visitorAddress(request('198.51.100.7')), '198.51.100.7');
  // A client-supplied X-Forwarded-For only adds entries before Shopify's own hop.
  assert.equal(visitorAddress(request('203.0.113.9, 10.0.0.1, 198.51.100.7')), '198.51.100.7');
  assert.equal(
    visitorAddress(request(undefined, { 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '203.0.113.10' })),
    null,
  );
  for (const bad of ['', 'not-an-ip', '198.51.100.7, junk', '1.2.3.4:80', 'x'.repeat(3000)])
    assert.equal(visitorAddress(request(bad)), null, bad);
});

test('IPv6 visitors are limited by their /64 and IPv4-mapped addresses as IPv4', () => {
  assert.equal(visitorAddress(request('2001:db8:1:2:aaaa::1')), '2001:db8:1:2::/64');
  assert.equal(visitorAddress(request('2001:0db8:0001:0002:ffff:0:0:9')), '2001:db8:1:2::/64');
  assert.equal(visitorAddress(request('2001:db8::1')), '2001:db8:0:0::/64');
  assert.equal(visitorAddress(request('::ffff:198.51.100.7')), '198.51.100.7');
});

test('only a keyed 32-byte hash leaves the module, and it depends on the app secret', () => {
  const key = createVisitorKey('secret-a');
  const a = key(request('198.51.100.7'));
  assert.equal(a?.byteLength, 32);
  assert.deepEqual(key(request('203.0.113.1, 198.51.100.7')), a);
  assert.notDeepEqual(createVisitorKey('secret-b')(request('198.51.100.7')), a);
  assert.ok(
    !Buffer.from(a ?? [])
      .toString('latin1')
      .includes('198.51.100.7'),
  );
  assert.deepEqual(key(request('2001:db8:1:2::1')), key(request('2001:db8:1:2:ffff::9')));
  assert.equal(key(request()), null);
});
