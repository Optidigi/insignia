// Process-level outbound denial, never an OS sandbox claim. Inbound listen remains available.

import childProcess from 'node:child_process';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import { denyFunctions } from './process-guard.mts';

function deny(): never {
  throw Error('OUTBOUND_DISABLED');
}
globalThis.fetch = async () => deny();
for (const module of [http, https]) {
  module.request = deny;
  module.get = deny;
}
net.connect = deny;
net.createConnection = deny;
net.Socket.prototype.connect = deny;
tls.connect = deny;
for (const module of [dns, childProcess]) denyFunctions(module, deny);
denyFunctions(dns.promises, deny);
// Node listen(host) calls lookup even for a literal address. Resolve that literal locally.
function lookup(host: string, options: unknown, callback?: unknown): void {
  if (host !== '127.0.0.1') deny();
  const cb = typeof options === 'function' ? options : callback;
  if (typeof cb !== 'function') deny();
  const all = options !== null && typeof options === 'object' && 'all' in options && options.all;
  queueMicrotask(() => (all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)));
}
// Node's overloaded callback/property declaration exceeds the runtime replacement's
// two call shapes. Both supported callback shapes are handled above.
dns.lookup = lookup as typeof dns.lookup;
async function promiseLookup(host: string, options?: unknown) {
  if (host !== '127.0.0.1') deny();
  return options !== null && typeof options === 'object' && 'all' in options && options.all
    ? [{ address: '127.0.0.1', family: 4 }]
    : { address: '127.0.0.1', family: 4 };
}
dns.promises.lookup = promiseLookup as typeof dns.promises.lookup;
syncBuiltinESMExports();
