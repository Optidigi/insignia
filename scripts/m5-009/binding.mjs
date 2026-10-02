import * as legacy from '../m5-004/binding.mjs';

export { digest, WORKFLOWS } from '../m5-004/binding.mjs';
export const BASE = '9ce56a1a9b8f674a3500f6592803f7a52e2ef18d';
export const EVIDENCE_ROOT = '/home/serveradmin/insignia-m5-009-handoff';
export const freeze = (root) => legacy.freeze(root, { profile: 'm5-009' });
export const verifyGate = (root, gate, binding, options = {}) =>
  legacy.verifyGate(root, gate, binding, { ...options, profile: 'm5-009' });
