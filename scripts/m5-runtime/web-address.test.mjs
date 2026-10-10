import assert from 'node:assert/strict';
import test from 'node:test';
import { ownedWebAddress } from './web-address.mjs';

test('web HTTP qualification uses the owned internal IPv4 when Docker publishes no ports', () => {
  assert.equal(
    ownedWebAddress({ Ports: {}, Networks: { owned: { IPAddress: '172.18.0.2' } } }, 'owned'),
    'http://172.18.0.2:3000/live',
  );
});

test('web HTTP qualification rejects foreign networks and actual host publication', () => {
  assert.throws(() => ownedWebAddress({ Ports: {}, Networks: { foreign: { IPAddress: '172.18.0.2' } } }, 'owned'));
  assert.throws(() =>
    ownedWebAddress(
      { Ports: { '3000/tcp': [{ HostPort: '3000' }] }, Networks: { owned: { IPAddress: '172.18.0.2' } } },
      'owned',
    ),
  );
});
