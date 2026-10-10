// Process-level outbound denial, never an OS sandbox claim. Inbound listen remains available.
import { createRequire, syncBuiltinESMExports } from 'node:module';

const require = createRequire(import.meta.url);
const deny = () => {
  throw Error('OUTBOUND_DISABLED');
};
globalThis.fetch = async () => {
  throw Error('OUTBOUND_DISABLED');
};
for (const name of ['http', 'https']) {
  const module = require('node:' + name);
  module.request = deny;
  module.get = deny;
}
const net = require('node:net');
net.connect = deny;
net.createConnection = deny;
net.Socket.prototype.connect = deny;
require('node:tls').connect = deny;
for (const name of ['dns', 'child_process']) {
  const module = require('node:' + name);
  for (const key of Object.keys(module))
    if (typeof module[key] === 'function' && !/^[A-Z]/.test(key)) module[key] = deny;
  if (module.promises)
    for (const key of Object.keys(module.promises))
      if (typeof module.promises[key] === 'function') module.promises[key] = deny;
}
// Node listen(host) calls lookup even for a literal address. Resolve that literal locally.
const dns = require('node:dns');
dns.lookup = (host, options, callback) => {
  if (host !== '127.0.0.1') deny();
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  queueMicrotask(() =>
    options?.all ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4),
  );
};
dns.promises.lookup = async (host, options) => {
  if (host !== '127.0.0.1') deny();
  return options?.all ? [{ address: '127.0.0.1', family: 4 }] : { address: '127.0.0.1', family: 4 };
};
syncBuiltinESMExports();
