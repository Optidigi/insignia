import {required,errorCode,object} from './validation.mts';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { qualificationTarget, qualifyRuntime } from './qualify-purchases.mts';

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

test('invalid later invocation replaces a previous CI PASS receipt and transcript with FAIL', async () => {
  const evidence = new URL('../../docs/delivery/evidence/m8-context-runtime/', import.meta.url);
  const result = new URL('runtime-role-ci.json', evidence),
    log = new URL('runtime-role-ci.log', evidence);
  await mkdir(evidence, { recursive: true });
  const prior = await Promise.all(
    [result, log].map((path) =>
      readFile(path).catch((error) => {
        if (errorCode(error) === 'ENOENT') return null;
        throw error;
      }),
    ),
  );
  try {
    await writeFile(result, JSON.stringify({ status: 'PASS', database: 'stale-owned-fixture' }));
    await writeFile(log, 'STALE PASS TRANSCRIPT');
    await assert.rejects(qualifyRuntime('postgres://owner@localhost/production'));
    assert.equal(object(JSON.parse(await readFile(result, 'utf8'))).status, 'FAIL');
    assert.doesNotMatch(await readFile(log, 'utf8'), /STALE PASS/);
  } finally {
    await Promise.all(
      [result, log].map((path, index) =>
        prior[index] === null ? rm(path, { force: true }) : writeFile(path, required(prior[index])),
      ),
    );
  }
});
