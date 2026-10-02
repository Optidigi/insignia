// Fixed successor profile; guards, settlement and transport remain shared.
import * as legacy from '../m5-004/operator.mjs';

export * from '../m5-004/operator.mjs';
export const LIMITS = Object.freeze({ ...legacy.LIMITS, predecessorArchive: 1 });
export const LIVE_DIRECTORY = '/home/serveradmin/insignia-m5-010-handoff/run';
export const initialize = (directory, binding, options = {}) =>
  legacy.initialize(directory, binding, { ...options, profile: 'm5-010' });
export const createOperator = (options) => legacy.createOperator({ ...options, profile: 'm5-010' });
export const assertIdentity = (data) => legacy.assertIdentity(data, { profile: 'm5-010' });
