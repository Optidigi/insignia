import assert from 'node:assert/strict';
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import type { SigningOwnerConfiguration } from './signing-owner-action.js';

const PLAN_PATH = '/run/insignia/signing-owner-plan.json';
const RUN_DIRECTORY = '/var/lib/insignia/signing-owner';

/** Only private owner metadata. It cannot supply release observations or SDK ports. */
export function parseSigningOwnerConfiguration(metadata: unknown, _env?: NodeJS.ProcessEnv): SigningOwnerConfiguration {
  assert.ok(metadata && typeof metadata === 'object' && !Array.isArray(metadata));
  const input = metadata as Record<string, unknown>;
  assert.deepEqual(Object.keys(input).sort(), ['binding', 'plan', 'version']);
  // A rotation plan, or an emergency plan (#375) armed the same way; each version has its own shape.
  assert.ok(input.version === 'm5-signing-owner-plan-v1' || input.version === 'm5-signing-emergency-plan-v1');
  const plan = input.plan;
  assert.ok(plan && typeof plan === 'object' && !Array.isArray(plan));
  assert.equal('revokeKeyIds' in plan, input.version === 'm5-signing-emergency-plan-v1');
  return {
    directory: `${RUN_DIRECTORY}/attempt`,
    plan: input.plan as SigningOwnerConfiguration['plan'],
    binding: input.binding as SigningOwnerConfiguration['binding'],
  };
}

/** Fixed read-only owner file. Absent allocation leaves the action unavailable. */
export function signingOwnerConfiguration(env: NodeJS.ProcessEnv): SigningOwnerConfiguration | undefined {
  let descriptor: number;
  try {
    descriptor = openSync(PLAN_PATH, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error('Signing configuration unavailable');
  }
  try {
    const stat = fstatSync(descriptor);
    assert.ok(stat.isFile() && stat.uid === process.getuid?.() && (stat.mode & 0o777) === 0o600 && stat.size <= 16000);
    return parseSigningOwnerConfiguration(JSON.parse(readFileSync(descriptor, 'utf8')), env);
  } catch {
    throw new Error('Signing configuration unavailable');
  } finally {
    closeSync(descriptor);
  }
}
