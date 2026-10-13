import assert from 'node:assert/strict';
import { test } from 'node:test';
import { qualificationTarget } from './qualify-runtime.mjs';

test('CI qualification creates only a unique owned loopback database and rejects remote or caller-selected identifiers', () => {
  const suffix = 'a'.repeat(32);
  const target = qualificationTarget(
    'postgres://owner:synthetic-password@localhost/insignia_test?sslmode=disable',
    suffix,
  );
  assert.equal(target.database, `synthetic_m8_runtime_${suffix}`);
  assert.equal(target.owner.pathname, '/insignia_test');
  assert.equal(target.target.pathname, `/synthetic_m8_runtime_${suffix}`);
  assert.equal(target.target.password, 'synthetic-password');
  assert.equal(
    qualificationTarget('postgres://owner@127.0.0.1/synthetic_owned', suffix).owner.pathname,
    '/synthetic_owned',
  );
  for (const input of [
    undefined,
    'postgres://owner@native.example/app',
    'postgres://owner@localhost/production',
    'postgres://owner@localhost/postgres',
    'postgres://owner@localhost/insignia',
    'postgres://owner@localhost/insignia_test?host=native.example',
    'postgres://owner@localhost/synthetic_test?dbname=production',
    'https://owner@localhost/app',
    'postgres://localhost/app',
    'postgres://owner@localhost/app;DROP',
  ]) {
    assert.throws(() => qualificationTarget(input, suffix));
  }
  assert.throws(() => qualificationTarget('postgres://owner@localhost/insignia_test', 'insignia_test'));
});
