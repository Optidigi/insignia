import assert from 'node:assert/strict';
import { record } from './fixtures.mts';
/** These are generated from the checked production source by each test's esbuild invocation. */
export async function builtProduction(url: string) {
  const value: unknown = await import(url);
  const isModule = (
    input: unknown,
  ): input is Pick<typeof import('../../../src/server/admin/production.ts'), 'createProductionAdminServices'> =>
    typeof record(input).createProductionAdminServices === 'function';
  assert.ok(isModule(value));
  return value;
}
export async function builtHttp(url: string) {
  const value: unknown = await import(url);
  const isModule = (
    input: unknown,
  ): input is Pick<typeof import('../../../src/server/admin/http.ts'), 'handleAdminRequest'> =>
    typeof record(input).handleAdminRequest === 'function';
  assert.ok(isModule(value));
  return value;
}
