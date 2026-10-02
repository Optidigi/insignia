// Fixed successor profile; documents, settlement and transport stay in the shared harness.
import * as legacy from '../m5-004/operator.mjs';

export * from '../m5-004/operator.mjs';
export const LIVE_DIRECTORY = '/home/serveradmin/insignia-m5-009-handoff/run';
export const initialize = (directory, binding, options = {}) =>
  legacy.initialize(directory, binding, { ...options, profile: 'm5-009' });
export const createOperator = (options) => legacy.createOperator({ ...options, profile: 'm5-009' });
export const assertIdentity = (data) => legacy.assertIdentity(data, { profile: 'm5-009' });
