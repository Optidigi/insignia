// Synthetic HTTP and child-process boundary objects; no network or SDK session.
import { EventEmitter } from 'node:events';
import type { IncomingHttpHeaders } from 'node:http';
export class SyntheticOwnerResponse extends EventEmitter {
  statusCode = 200;
  headers: IncomingHttpHeaders = { 'content-type': 'application/json' };
  complete = true;
  destroy() {}
}
export class SyntheticOwnerRequest extends EventEmitter {
  end: (bytes: Buffer) => unknown = () => {};
  destroy() {}
}
export class SyntheticManagementChild extends EventEmitter {
  stdout = new EventEmitter();
  exitCode: number | null = null;
  stdin: { write(value: string): unknown; end(): unknown } = { write() {}, end() {} };
  kill: (signal: NodeJS.Signals) => unknown = () => {};
}
