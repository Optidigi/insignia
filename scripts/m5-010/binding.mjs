import * as legacy from '../m5-004/binding.mjs';

export { digest, WORKFLOWS } from '../m5-004/binding.mjs';
export const BASE = '25e6c487741e1685637d351137d9671033f3c53d';
export const EVIDENCE_ROOT = '/home/serveradmin/insignia-m5-010-handoff';
export const freeze = (root) => legacy.freeze(root, { profile: 'm5-010' });
export const verifyGate = (root, gate, binding, options = {}) =>
  legacy.verifyGate(root, gate, binding, { ...options, profile: 'm5-010' });
