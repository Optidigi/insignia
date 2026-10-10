import assert from 'node:assert/strict';

export function ownedWebAddress(settings, network) {
  assert.deepEqual(Object.keys(settings.Networks), [network], 'Exact owned internal network required');
  assert.ok(
    Object.values(settings.Ports).every((bindings) => bindings === null),
    'Host publication forbidden',
  );
  const address = settings.Networks[network].IPAddress;
  assert.match(address, /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/);
  assert.ok(
    address.split('.').every((part) => Number(part) <= 255),
    'IPv4 address required',
  );
  return `http://${address}:3000/live`;
}
