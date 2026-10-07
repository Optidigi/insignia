import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ShopifyAvailabilityHoldError } from '../../packages/shopify/dist/index.js';
import { createOperator, requireValue, Stop } from './operator.mjs';

// The only native capability is module-private and delivered only through the
// operator's reserved-dispatch wrapper. Import dependencies perform no requests.
const nativeFetch = globalThis.fetch.bind(globalThis);
let denials = 0;
class NetworkEscapeDenied extends ShopifyAvailabilityHoldError {
  constructor() {
    super('network_or_timeout');
    this.code = 'network_escape_denied';
    this.message = 'network_escape_denied';
  }
}
const deny = async () => {
  denials++;
  throw new NetworkEscapeDenied();
};
Object.defineProperty(globalThis, 'fetch', { value: deny, writable: false, configurable: false });
export function assertGuard() {
  requireValue(globalThis.fetch === deny && denials === 0, 'network_escape_denied');
}
export function createGuardedOperator(options) {
  assertGuard();
  requireValue(options.synthetic === true || options.fetchImpl === undefined, 'native_transport_private');
  // Only the explicitly synthetic entry may provide an in-memory/loopback mock.
  const transport = options.synthetic === true ? options.fetchImpl : nativeFetch;
  requireValue(typeof transport === 'function' && transport !== globalThis.fetch, 'transport_required');
  let op, dispatched;
  const current = options.assertCurrent;
  op = createOperator({
    ...options,
    assertCurrent: () => {
      assertGuard();
      current();
    },
    fetchImpl: async (url, init) => {
      let index,
        crossed = false;
      try {
        assertGuard();
        current();
        const state = op.state();
        const durable = JSON.parse(readFileSync(resolve(op.directory, 'register.json')));
        requireValue(JSON.stringify(state) === JSON.stringify(durable), 'transport_accounting_mismatch');
        const event = state.events[state.pending];
        index = state.pending;
        requireValue(
          event?.invoked === true &&
            event.transportOrdinal === dispatched + 1 &&
            state.transport.invocations === dispatched + 1 &&
            event.transportPid === process.pid &&
            state.events.filter((e) => e.invoked).length === state.transport.invocations &&
            state.counts.auth + state.counts.graphql === state.events.length &&
            !state.transport.mismatch,
          'transport_accounting_mismatch',
        );
        const body = JSON.parse(init.body);
        requireValue(
          JSON.stringify(event.request) ===
            JSON.stringify(event.kind === 'auth' ? { client_id: body.client_id, grant_type: body.grant_type } : body),
          'transport_accounting_mismatch',
        );
        if (event.operation === 'archive') op.assertArchiveDispatch(index);
        dispatched++;
        crossed = true;
        return transport(url, init);
      } catch (error) {
        if (!crossed && Number.isInteger(index)) op.rejectDispatch(index, error.kind ?? 'local_dispatch_failure');
        if (error instanceof Stop && ['network_escape_denied', 'transport_accounting_mismatch'].includes(error.kind)) {
          op.patch((s) => {
            s.transport.mismatch = true;
          });
        }
        throw error;
      }
    },
  });
  dispatched = op.state().transport.invocations;
  return {
    ...op,
    transportAudit: () => ({
      reserved: op.state().transport.invocations,
      dispatched,
      denied: op.state().transport.denials,
      matches:
        dispatched + op.state().transport.denials === op.state().transport.invocations &&
        !op.state().transport.mismatch &&
        denials === 0,
    }),
  };
}
