// A child-process test driver: every fixed provider-shaped request is forwarded
// only to the parent loopback mock. The production factory itself is unchanged.
import { runSynthetic } from './qualification.mjs';

const [directory, phase, address] = process.argv.slice(2);
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(address)) throw new Error('Loopback only');
const loopbackFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error('Uninjected network transport');
};
const result = await runSynthetic({
  directory,
  phase,
  credentialLoader: () => ({ secret: 'synthetic-secret' }),
  fetchImpl: async (url, init) =>
    loopbackFetch(address, { method: 'POST', body: JSON.stringify({ url, body: JSON.parse(init.body) }) }),
});
process.stdout.write(JSON.stringify(result));
