import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as readiness from '../../src/server/admin/release-evidence.ts';

const scope = { shopId: 'trusted-shop', installationGeneration: '1', appClientId: 'trusted-client' };
const candidate = {
  shopId: scope.shopId,
  scope: { installationGeneration: scope.installationGeneration },
  availabilityScope: { appClientId: scope.appClientId },
};
test('preloaded trusted merchant day is synchronous across DST and server-day boundaries', () => {
  const currentDay = readiness.createTrustedMerchantCalendar(scope, 'America/New_York');
  for (const instant of ['2026-03-08T06:30:00Z', '2026-03-08T07:30:00Z']) {
    assert.equal(currentDay(candidate, new Date(instant)), 20520);
  }
  for (const instant of ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z']) {
    assert.equal(currentDay(candidate, new Date(instant)), 20758);
  }
  const west = readiness.createTrustedMerchantCalendar(scope, 'America/Los_Angeles');
  assert.equal(west(candidate, new Date('2026-10-08T04:00:00Z')), 20733);
  assert.equal(west(candidate, new Date('2026-10-08T08:00:00Z')), 20734);
  assert.throws(() => west({ ...candidate, scope: { installationGeneration: '2' } }, new Date()), /scope/);
  assert.throws(() => readiness.createTrustedMerchantCalendar(scope, 'Mars/Olympus'), /calendar/);
  assert.throws(() => readiness.createTrustedMerchantCalendar(scope, '+02:00'), /calendar/);
});
