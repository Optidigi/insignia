import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as legacy from '../m5-004/qualification.mjs';
import { LIVE_DIRECTORY, requireValue, Stop } from './operator.mjs';

export { protectedCredentials, REQUEST_PLAN } from '../m5-004/qualification.mjs';
export const qualify = (options) => legacy.qualify({ ...options, profile: 'm5-009' });
export const qualifySynthetic = (options) => legacy.qualifySynthetic({ ...options, profile: 'm5-009' });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    requireValue(process.argv.length === 2 || resolve(process.argv[2]) === LIVE_DIRECTORY, 'canonical_register');
    const binding = JSON.parse(readFileSync(resolve(LIVE_DIRECTORY, 'binding.json')));
    const gate = JSON.parse(readFileSync(resolve(LIVE_DIRECTORY, 'gate.json')));
    const result = await qualify({ directory: LIVE_DIRECTORY, binding, gate });
    process.stdout.write(
      JSON.stringify({ outcome: result.outcome, stop: result.stop ?? null, final: result.final?.outcome }) + '\n',
    );
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        outcome: 'LOCAL_OR_AUTH_GATE_STOP',
        kind: error instanceof Stop ? error.kind : 'unclassified_local_error',
      }) + '\n',
    );
    process.exitCode = 1;
  }
}
