import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, test } from 'vitest';
import { createDurableCore, sha256CanonicalJson } from '../src/index.js';

const connectionString = process.env.DATABASE_URL;
async function appendFixture(
  pool: Pool,
  core: ReturnType<typeof createDurableCore>,
  replacement?: {
    scope: { shopId: string; installationGeneration: string; appClientId: string };
    version?: string;
    digest?: string;
  },
) {
  const shopId = replacement?.scope.shopId ?? randomUUID();
  if (!replacement)
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, {
        shopId,
        shopDomain: 'm' + randomUUID().replaceAll('-', '') + '.myshopify.com',
        shopifyShopId: (BigInt('0x' + shopId.replaceAll('-', '').slice(0, 12)) + 1n).toString(),
      }),
    );
  const observedAt = new Date().toISOString();
  const build = {
    schemaVersion: 1,
    shopId,
    installationGeneration: '1',
    appClientId: replacement?.scope.appClientId ?? 'trusted-' + shopId,
    sourceCommit: 'a'.repeat(40),
    appVersionRef: replacement?.version ?? '1158986629121',
    devPreviewRef: null,
    transform: {
      functionId: 'transform-id',
      handle: 'insignia-experimental-v2-transform',
      apiType: 'cart_transform',
      apiVersion: '2026-07',
      inputQuerySha256: 'b'.repeat(64),
      wasmSha256: 'c'.repeat(64),
    },
    validation: {
      functionId: 'validation-id',
      handle: 'insignia-experimental-v2-validation',
      apiType: 'cart_checkout_validation',
      apiVersion: '2026-07',
      inputQuerySha256: 'd'.repeat(64),
      wasmSha256: 'e'.repeat(64),
    },
  };
  const record = {
    version: 'm5-trusted-release-v1',
    recordId: randomUUID(),
    activeAppVersionRef: build.appVersionRef,
    attestation: {
      ...build,
      evidenceKind: 'RELEASE_BOUND',
      observedAt,
      expiresAt: new Date(Date.parse(observedAt) + 30_000).toISOString(),
    },
  };
  const proof = 'f'.repeat(64);
  const digest = sha256CanonicalJson({
    trustedRecord: record,
    expectedBuild: build,
    activeVersionObservedAt: observedAt,
    activeVersionEvidenceSha256: proof,
  });
  await pool.query(
    'INSERT INTO trusted_release_records(record_id,shop_id,installation_generation,app_client_id,active_app_version_ref,expected_build,trusted_record,active_version_observed_at,active_version_evidence_sha256,evidence_digest) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9)',
    [
      record.recordId,
      shopId,
      build.appClientId,
      build.appVersionRef,
      build,
      record,
      observedAt,
      proof,
      replacement?.digest ?? digest,
    ],
  );
  return { scope: { shopId, installationGeneration: '1', appClientId: build.appClientId }, record, build };
}

test('operator release evidence is append-only and the runtime role has SELECT-only access', async () => {
  const pool = new Pool({ connectionString });
  const core = createDurableCore(new Pool({ connectionString }));
  const role = 'm5022_read_' + randomUUID().replaceAll('-', '');
  try {
    const { record } = await appendFixture(pool, core);
    await expect(
      pool.query('UPDATE trusted_release_records SET evidence_digest=$1 WHERE record_id=$2', [
        '0'.repeat(64),
        record.recordId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('DELETE FROM trusted_release_records WHERE record_id=$1', [record.recordId]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query('TRUNCATE trusted_release_records')).rejects.toMatchObject({ code: '23514' });
    await pool.query('CREATE ROLE ' + role + ' NOLOGIN');
    await pool.query('GRANT SELECT ON trusted_release_records TO ' + role);
    const client = await pool.connect();
    try {
      await client.query('SET ROLE ' + role);
      expect(
        (await client.query('SELECT record_id FROM trusted_release_records WHERE record_id=$1', [record.recordId]))
          .rowCount,
      ).toBe(1);
      for (const statement of [
        "INSERT INTO trusted_release_records(record_id) VALUES('forbidden')",
        'UPDATE trusted_release_records SET record_id=record_id',
        'DELETE FROM trusted_release_records',
        'TRUNCATE trusted_release_records',
      ])
        await expect(client.query(statement)).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.query('RESET ROLE');
      client.release();
    }
  } finally {
    await pool.query('DROP OWNED BY ' + role).catch(() => {});
    await pool.query('DROP ROLE ' + role).catch(() => {});
    await core.close();
    await pool.end();
  }
});

test('trusted release source loads exact active scope only through a read-only runtime credential', async () => {
  const pool = new Pool({ connectionString });
  const operatorCore = createDurableCore(new Pool({ connectionString }));
  const role = 'm5022_source_' + randomUUID().replaceAll('-', '');
  let runtime: ReturnType<typeof createDurableCore> | undefined;
  try {
    const fixture = await appendFixture(pool, operatorCore);
    await pool.query('CREATE ROLE ' + role + ' NOLOGIN');
    await pool.query('GRANT USAGE ON SCHEMA public TO ' + role);
    await pool.query('GRANT SELECT ON trusted_release_records,shops,installation_generations TO ' + role);
    runtime = createDurableCore(new Pool({ connectionString, options: '-c role=' + role }));
    const input = { scope: fixture.scope, expectedActiveAppVersionRef: '1158986629121', now: new Date() };
    expect(await runtime.trustedReleaseRecords.read(input)).toMatchObject({
      record: fixture.record,
      expectedBuild: fixture.build,
    });
    expect(await operatorCore.trustedReleaseRecords.read(input)).toBeNull();
    expect(
      await runtime.trustedReleaseRecords.read({ ...input, expectedActiveAppVersionRef: '1153019904001' }),
    ).toBeNull();
    expect(
      await runtime.trustedReleaseRecords.read({ ...input, scope: { ...fixture.scope, installationGeneration: '2' } }),
    ).toBeNull();
    expect(await runtime.trustedReleaseRecords.read({ ...input, now: new Date(Date.now() + 31_000) })).toBeNull();
    expect(
      await runtime.trustedReleaseRecords.read({
        ...input,
        now: new Date(Date.parse(fixture.record.attestation.observedAt) - 1),
      }),
    ).toBeNull();
    // Append a new invalid proof: an older valid record must never rescue it.
    await appendFixture(pool, operatorCore, { scope: fixture.scope, digest: '0'.repeat(64) });
    expect(await runtime.trustedReleaseRecords.read({ ...input, now: new Date() })).toBeNull();
    await appendFixture(pool, operatorCore, { scope: fixture.scope, version: '1153019904001' });
    expect(await runtime.trustedReleaseRecords.read({ ...input, now: new Date() })).toBeNull();
    const restored = await appendFixture(pool, operatorCore, { scope: fixture.scope });
    expect(await runtime.trustedReleaseRecords.read({ ...input, now: new Date() })).toMatchObject({
      record: restored.record,
    });
    // A latest independent app-level Active observation cannot be ignored by another shop.
    const other = await appendFixture(pool, operatorCore);
    await appendFixture(pool, operatorCore, {
      scope: { ...other.scope, appClientId: fixture.scope.appClientId },
      version: '1153019904001',
    });
    expect(await runtime.trustedReleaseRecords.read({ ...input, now: new Date() })).toBeNull();
  } finally {
    await runtime?.close();
    await operatorCore.close();
    await pool.query('DROP OWNED BY ' + role).catch(() => {});
    await pool.query('DROP ROLE ' + role).catch(() => {});
    await pool.end();
  }
});
