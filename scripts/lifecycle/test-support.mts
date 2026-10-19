import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { required } from './types.mts';

export { json, record, required } from './types.mts';
export function pipe(value: unknown): Writable {
  if (!(value instanceof Writable)) throw Error('Expected private writable pipe');
  return value;
}
export function portOf(server: { address(): AddressInfo | string | null }): number {
  const address = required(server.address());
  if (typeof address === 'string') throw Error('Expected loopback TCP listener');
  return address.port;
}
