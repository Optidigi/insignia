import assert from 'node:assert/strict';

export function ownedWebAddress(settings: unknown, network: string) {
  assert(settings && typeof settings === 'object' && 'Networks' in settings && 'Ports' in settings);
  assert(settings.Networks && typeof settings.Networks === 'object' && !Array.isArray(settings.Networks));
  assert(settings.Ports && typeof settings.Ports === 'object' && !Array.isArray(settings.Ports));
  const networks = Object.fromEntries(Object.entries(settings.Networks));
  assert.deepEqual(Object.keys(networks), [network], 'Exact owned internal network required');
  assert.ok(
    Object.values(settings.Ports).every((bindings) => bindings === null),
    'Host publication forbidden',
  );
  const entry: unknown = networks[network];
  assert(entry && typeof entry === 'object' && 'IPAddress' in entry && typeof entry.IPAddress === 'string');
  const address = entry.IPAddress;
  assert.match(address, /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/);
  assert.ok(
    address.split('.').every((part) => Number(part) <= 255),
    'IPv4 address required',
  );
  return `http://${address}:3000/live`;
}
