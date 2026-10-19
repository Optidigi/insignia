import assert from 'node:assert/strict';

function required<T>(value: T | null | undefined): T {
  assert(value !== null && value !== undefined);
  return value;
}

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';

const status = readFileSync('/proc/1/status', 'utf8');
const field = (name: string) =>
  required(required(status.split('\n').find((line) => line.startsWith(`${name}:`))).split(':')[1]).trim();
let rootWriteError: unknown = null;
try {
  writeFileSync('/tmp/m5-image-root-write-probe', 'must fail');
} catch (error) {
  rootWriteError = error && typeof error === 'object' && 'code' in error ? error.code : null;
}
const externalConnect = await new Promise<boolean>((resolve) => {
  // Documentation-only IP: no Shopify/provider request, DNS lookup or provider payload.
  const socket = connect({ host: '192.0.2.1', port: 443 });
  const finish = (value: boolean) => {
    socket.destroy();
    resolve(value);
  };
  socket.setTimeout(1500, () => finish(false));
  socket.once('error', () => finish(false));
  socket.once('connect', () => finish(true));
});
console.log(
  JSON.stringify({
    argv: readFileSync('/proc/1/cmdline', 'utf8').split('\0').filter(Boolean),
    uid: field('Uid').split(/\s+/).map(Number),
    gid: field('Gid').split(/\s+/).map(Number),
    capabilities: ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'].map(field),
    noNewPrivileges: Number(field('NoNewPrivs')),
    rootWriteError,
    externalConnect,
    defaultRoute: readFileSync('/proc/net/route', 'utf8')
      .trim()
      .split('\n')
      .slice(1)
      .some((line) => line.trim().split(/\s+/)[1] === '00000000'),
    nodeExecutableSha256: createHash('sha256').update(readFileSync('/proc/1/exe')).digest('hex'),
  }),
);
