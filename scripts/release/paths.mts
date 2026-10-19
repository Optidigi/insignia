import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Fixed immutable artifact layout; private mutable custody is mounted separately.
export const VERIFIER_CODE = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const VERIFIER_STATE = '/var/lib/insignia/verifier';
export const VERIFIER_AUTH_HOME = '/var/lib/insignia/verifier-auth';
export const VERIFIER_SDK = `${VERIFIER_CODE}/sdk`;
export const VERIFIER_NODE = `${VERIFIER_CODE}/bin/node`;
export const VERIFIER_SOCKET_DIRECTORY = '/run/insignia/release-verification';

// Generated from the reviewed typed session adapter using pinned Node 24.21.0.
export const SESSION_CLIENT_SHA256 = 'fc8145fb0049a3039605924c2505aaa797c842a356c1cfe82d6cd13bb1de564f';
