import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Fixed immutable artifact layout; private mutable custody is mounted separately.
export const VERIFIER_CODE = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const VERIFIER_STATE = '/var/lib/insignia/verifier';
export const VERIFIER_AUTH_HOME = '/var/lib/insignia/verifier-auth';
export const VERIFIER_SDK = `${VERIFIER_CODE}/sdk`;
export const VERIFIER_NODE = `${VERIFIER_CODE}/bin/node`;
export const VERIFIER_SOCKET_DIRECTORY = '/run/insignia/release-verification';
