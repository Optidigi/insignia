import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  inspectPriorBridgeHandoverSettlement,
  inspectPriorCollectorSettlement,
  runBoundedCollectorProcess,
} from './launch.mts';
import { required } from './validation.mts';

const recordId = '00000000-0000-4000-8000-000000000001';
const closed = (ambiguousWrite = false) => ({
  version: 'm5-owner-trusted-release-collector-v1',
  classification: ambiguousWrite ? 'TRUSTED_RELEASE_COLLECT_STOPPED' : 'TRUSTED_RELEASE_COLLECT_APPEND_ACK',
  appendAttempted: true,
  appendAcknowledged: !ambiguousWrite,
  ambiguousWrite,
  retryAuthorized: false,
  signingAttempted: false,
  staffAuthorityGranted: false,
  sdkInternalHttpAttempts: 'NOT_ASSERTED',
  deployedWasmServerDigest: 'UNAVAILABLE_NOT_ASSERTED',
});
const operations = [
  'READ_DURABLE_TENANT_OPEN',
  'AUTHENTICATE_EXISTING_MANAGEMENT_SESSION',
  'ActiveAppReleaseFromApiKey',
  'AppVersions',
  'AppVersionByTag',
  'CLIENT_CREDENTIALS_ONCE',
  'READ_NATIVE_INSTALLATION_OPEN',
  'READ_ORIGINAL_FUNCTION_OWNERSHIP',
  'READ_NATIVE_INSTALLATION_CLOSE',
  'AppVersions',
  'READ_DURABLE_TENANT_CLOSE',
  'APPEND_TRUSTED_RELEASE_ONCE',
];
async function writeCollectorRecords(phase: string, id: string, sequence: string[]) {
  await mkdir(phase, { mode: 0o700 });
  const write = (name: string, value: unknown) => writeFile(join(phase, name), JSON.stringify(value), { mode: 0o600 });
  await write('invocation.json', {
    version: 'm5-owner-collector-invocation-v1',
    recordId: id,
    sdkReadMethods: 4,
    ownerOAuthPosts: 1,
    ownerAdminSelectedReads: 3,
    appendCalls: 1,
    maximumDurationMs: 300000,
    sdkInternalHttpAttempts: 'NOT_ASSERTED',
    retryAuthorized: false,
  });
  await write('observations.json', {
    recordId: id,
    inputDigest: '0'.repeat(64),
    activeObservation: {},
    moduleObservation: {},
    readiness: {},
  });
  for (let index = 0; index < sequence.length; index++) {
    const record = {
      version: 'm5-owner-collector-reservation-v1',
      ordinal: index + 1,
      operation: sequence[index],
      reservedAt: '2026-10-11T00:00:00.000Z',
    };
    if (index === 11) Object.assign(record, { recordId: id, inputDigest: '0'.repeat(64) });
    await write(`reservation-${String(index + 1).padStart(2, '0')}.json`, record);
  }
}
async function prior(parent: string, receipt: unknown = undefined) {
  const phase = join(parent, `m5-trusted-release-collector-native-run-20261011-${recordId}`);
  await writeCollectorRecords(phase, recordId, operations);
  if (receipt) await writeFile(join(phase, 'receipt.json'), JSON.stringify(receipt), { mode: 0o600 });
  return phase;
}
test('an earlier complete append reservation without settlement blocks every fresh owner intent', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'insignia-owner-launch-'));
  try {
    await prior(parent);
    await assert.rejects(inspectPriorCollectorSettlement(parent), /prior_settlement_unknown/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
test('only exact known settled receipts permit a distinct fresh intent; ambiguous, foreign and symlink receipts stop', async () => {
  for (const value of [closed(), closed(true), { ...closed(), token: 'synthetic-forbidden' }, null]) {
    const parent = await mkdtemp(join(tmpdir(), 'insignia-owner-launch-'));
    try {
      const phase = await prior(parent, value);
      if (value === null) await symlink('/etc/passwd', join(phase, 'receipt.json'));
      if (value?.classification === 'TRUSTED_RELEASE_COLLECT_APPEND_ACK' && !('token' in value))
        assert.equal(required((await inspectPriorCollectorSettlement(parent))[0]).settled, true);
      else await assert.rejects(inspectPriorCollectorSettlement(parent), /prior_settlement_unknown/);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  }
});
test('unrelated private captures are not read or treated as append authority', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'insignia-owner-launch-'));
  try {
    await symlink('/not-readable', join(parent, 'unrelated-private-capture'));
    assert.deepEqual(await inspectPriorCollectorSettlement(parent), []);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
async function processControl(
  source: string,
  limits: Pick<
    Parameters<typeof runBoundedCollectorProcess>[0],
    'verificationRequest' | 'timeoutMs' | 'maximumBytes'
  > = {},
) {
  const parent = await mkdtemp(join(tmpdir(), 'insignia-owner-launch-'));
  const script = join(parent, 'synthetic.mjs');
  await writeFile(script, source, { mode: 0o600 });
  const packet = Buffer.from(
    JSON.stringify({
      databaseUrl: 'synthetic-private-url',
      clientSecret: 'synthetic-client-secret',
      appendPassword: 'synthetic-private-password',
      recordId,
    }),
  );
  const observation: {
    value?: Parameters<NonNullable<Parameters<typeof runBoundedCollectorProcess>[0]['spawnChild']>>[0];
  } = {};
  const result = await runBoundedCollectorProcess({
    packet,
    phaseRoot: parent,
    recordId,
    ...limits,
    spawnChild(input) {
      observation.value = input;
      return spawn(process.execPath, [script], {
        cwd: parent,
        env: { ...input.env, SYNTHETIC_PARENT: parent },
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe', ...(limits.verificationRequest ? ['pipe' as const] : [])],
      });
    },
  });
  return { parent, packet, result, observed: required(observation.value) };
}
const reserveSource = `import {mkdir,writeFile} from 'node:fs/promises'; import {join} from 'node:path';
const phase=join(process.env.SYNTHETIC_PARENT,'m5-trusted-release-collector-native-run-20261011-${recordId}');
await (${stripTypeScriptTypes(writeCollectorRecords.toString())})(phase,${JSON.stringify(recordId)},${JSON.stringify(operations)});`;
test('real child receives private packet only on stdin, emits only matching closed durable receipt and zeroes packet', async () => {
  const c = await processControl(
    reserveSource +
      `let input=''; for await(const b of process.stdin)input+=b; const p=JSON.parse(input); if(!p.clientSecret||process.env.NODE_OPTIONS||process.argv.length!==2)process.exit(2); const receipt=${JSON.stringify(closed())}; await writeFile(join(phase,'receipt.json'),JSON.stringify(receipt),{mode:0o600}); console.log(JSON.stringify(receipt));`,
  );
  try {
    assert.equal(c.result.classification, 'TRUSTED_RELEASE_COLLECT_APPEND_ACK');
    assert.equal(
      c.packet.every((byte) => byte === 0),
      true,
    );
    assert.deepEqual(Object.keys(c.observed.env).sort(), ['HOME', 'LANG', 'PATH', 'TERM']);
    assert.ok(c.observed.script.endsWith('/collector-native.mts'));
    assert.ok(!JSON.stringify(c.result).includes('synthetic-private'));
  } finally {
    await rm(c.parent, { recursive: true, force: true });
  }
});
test('raw private stdout or mismatched durable receipt never escapes safe result', async () => {
  for (const output of ['synthetic-client-secret', { ...closed(), token: 'synthetic-client-secret' }]) {
    const c = await processControl(
      reserveSource +
        `for await(const b of process.stdin){}; console.log(${JSON.stringify(typeof output === 'string' ? output : JSON.stringify(output))});`,
    );
    try {
      assert.equal(c.result.ambiguousWrite, true);
      assert.ok(!JSON.stringify(c.result).includes('synthetic-client-secret'));
    } finally {
      await rm(c.parent, { recursive: true, force: true });
    }
  }
});
test('combined stdout/stderr excess and timeout stop the real process group and retain append uncertainty', async () => {
  for (const [body, limits] of [
    [`process.stderr.write('x'.repeat(4096));setInterval(()=>{},1000);`, { maximumBytes: 1024, timeoutMs: 2000 }],
    [`setInterval(()=>{},1000);`, { timeoutMs: 500 }],
  ] as const) {
    const c = await processControl(`${reserveSource}for await(const b of process.stdin){};${body}`, limits);
    try {
      assert.equal(c.result.ambiguousWrite, true);
      assert.equal(c.result.retryAuthorized, false);
      assert.ok(['OWNER_PROCESS_OUTPUT_LIMIT', 'OWNER_PROCESS_TIMEOUT'].includes(c.result.classification));
    } finally {
      await rm(c.parent, { recursive: true, force: true });
    }
  }
});
test('normal leader exit still kills a surviving descendant in its process group', async () => {
  const c = await processControl(
    reserveSource +
      `import {spawn} from 'node:child_process';const descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});await writeFile(join(process.env.SYNTHETIC_PARENT,'descendant.pid'),String(descendant.pid));for await(const b of process.stdin){};const receipt=${JSON.stringify(closed())};await writeFile(join(phase,'receipt.json'),JSON.stringify(receipt),{mode:0o600}); console.log(JSON.stringify(receipt));process.exit(0);`,
  );
  try {
    assert.equal(c.result.classification, 'TRUSTED_RELEASE_COLLECT_APPEND_ACK');
    const pid = Number(await readFile(join(c.parent, 'descendant.pid'), 'utf8'));
    let state: string | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        state = required((await readFile(`/proc/${pid}/stat`, 'utf8')).split(' ')[2]);
      } catch {
        state = undefined;
      }
      if (state === undefined || state === 'Z') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(state === undefined || state === 'Z', 'surviving executable descendant must be stopped');
  } finally {
    await rm(c.parent, { recursive: true, force: true });
  }
});

test('a FIFO masquerading as a prior receipt fails locally rather than hanging preflight', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'insignia-owner-launch-'));
  try {
    const phase = await prior(parent);
    const { spawnSync } = await import('node:child_process');
    assert.equal(spawnSync('/usr/bin/mkfifo', [join(phase, 'receipt.json')]).status, 0);
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import assert from 'node:assert/strict';import{inspectPriorCollectorSettlement}from ${JSON.stringify(new URL('./launch.mts', import.meta.url).href)};await assert.rejects(inspectPriorCollectorSettlement(${JSON.stringify(parent)}),/prior_settlement_unknown/);`,
      ],
      { timeout: 3000, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, 'preflight must reject before a FIFO read can block');
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('settled pre-append freshness failure permits fresh intent but changed ordinal/UUID/digest and duplicate fields stop', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'insignia-owner-launch-'));
  try {
    const receipt = {
      ...closed(),
      classification: 'TRUSTED_RELEASE_COLLECT_STOPPED',
      appendAttempted: false,
      appendAcknowledged: false,
    };
    const phase = await prior(parent, receipt);
    assert.equal(required((await inspectPriorCollectorSettlement(parent))[0]).settled, true);
    const path = join(phase, 'reservation-12.json');
    const original = await readFile(path, 'utf8');
    const record = JSON.parse(original);
    for (const changed of [
      { ...record, ordinal: 11 },
      { ...record, recordId: '00000000-0000-4000-8000-000000000002' },
      { ...record, inputDigest: '1'.repeat(64) },
    ]) {
      await writeFile(path, JSON.stringify(changed));
      await assert.rejects(inspectPriorCollectorSettlement(parent), /prior_settlement_unknown/);
    }
    await writeFile(path, `${original.slice(0, -1)},"ordinal":12}`);
    await assert.rejects(inspectPriorCollectorSettlement(parent), /prior_settlement_unknown/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
test('private stdin is bounded for a stalled pipe and oversized packet', async () => {
  const { PassThrough } = await import('node:stream');
  const { readPrivatePacket } = await import('./launch.mts');
  const stalled = new PassThrough();
  await assert.rejects(readPrivatePacket(stalled, 50), /private_packet_timeout/);
  const oversized = new PassThrough();
  oversized.end(Buffer.alloc(16385));
  await assert.rejects(readPrivatePacket(oversized), /private_packet_limit/);
});

test('actual SDK auth/session modules are code inputs while private credential filenames remain excluded', async () => {
  const { qualifyCodeInputPath } = await import('./launch.mts');
  const root = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
  for (const relative of [
    'node_modules/.pnpm/@shopify+shopify-api@15.0.0/node_modules/@shopify/shopify-api/dist/cjs/lib/session/session.js',
    'node_modules/.pnpm/@shopify+shopify-api@15.0.0/node_modules/@shopify/shopify-api/dist/esm/lib/session/session.mjs',
  ])
    assert.doesNotThrow(() => qualifyCodeInputPath(`${root}/${relative}`));
  for (const relative of [
    '.env',
    'private/.env.production',
    'private/auth.json',
    'private/session.json',
    'private/context.json',
  ])
    assert.throws(() => qualifyCodeInputPath(`${root}/${relative}`));
  assert.throws(() => qualifyCodeInputPath('/tmp/foreign/auth.js'), /input_path_unqualified/);
});

test('the fixed child receives only scoped metadata on its private descriptor separate from credentials', async () => {
  const verificationRequest = {
    requestId: recordId,
    expectedActiveAppVersionRef: '1163229200385',
    deadlineMs: Date.now() + 60_000,
    binding: {
      shopId: 'synthetic-tenant',
      installationGeneration: '1',
      appClientId: '1443cf6d03d39edae7c101a943c5c684',
      authorizationGeneration: '22222222-2222-4222-8222-222222222222',
      authorizationEpoch: 0,
      externalInstallationId: 'gid://shopify/AppInstallation/321',
    },
  };
  const c = await processControl(
    reserveSource +
      `import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';
     assert.equal(process.env.INSIGNIA_RELEASE_VERIFICATION_FD,'3');
     const metadata=JSON.parse(readFileSync(3,'utf8'));assert.deepEqual(metadata,${JSON.stringify(verificationRequest)});
     for await(const chunk of process.stdin){};
     const receipt=${JSON.stringify(closed())};await writeFile(join(phase,'receipt.json'),JSON.stringify(receipt),{mode:0o600});console.log(JSON.stringify(receipt));`,
    { verificationRequest },
  );
  try {
    assert.equal(c.result.classification, 'TRUSTED_RELEASE_COLLECT_APPEND_ACK');
    assert.equal(c.observed.env.INSIGNIA_RELEASE_VERIFICATION_FD, '3');
    assert.ok(!JSON.stringify(verificationRequest).includes('synthetic-private'));
    assert.ok(c.packet.every((byte) => byte === 0));
  } finally {
    await rm(c.parent, { recursive: true, force: true });
  }
});

test('bridge handover accepts actual ACK and STOP launcher results only with matching closed child evidence', async () => {
  const stopped = {
    ...closed(),
    classification: 'TRUSTED_RELEASE_COLLECT_STOPPED',
    appendAttempted: false,
    appendAcknowledged: false,
  };
  for (const collector of [closed(), stopped]) {
    const c = await processControl(
      reserveSource +
        `
      for await(const b of process.stdin){};
      const receipt=${JSON.stringify(collector)};
      await writeFile(join(phase,'receipt.json'),JSON.stringify(receipt),{mode:0o600});
      console.log(JSON.stringify(receipt));process.exit(${collector === stopped ? 1 : 0});`,
    );
    try {
      assert.equal(c.result.classification, collector.classification);
      assert.equal(c.result.version, 'm5-owner-trusted-release-launch-v1');
      const phase = join(c.parent, `m5-trusted-release-collector-native-run-20261011-${recordId}`);
      const intent = join(c.parent, `m5-trusted-release-launch-intent-${recordId}`);
      await mkdir(intent, { mode: 0o700 });
      await writeFile(
        join(intent, 'intent.json'),
        JSON.stringify({
          version: 'm5-owner-trusted-release-launch-intent-v1',
          recordId,
          childPhase: phase.split('/').at(-1),
          retryAuthorized: false,
        }),
        { mode: 0o600 },
      );
      await assert.rejects(inspectPriorBridgeHandoverSettlement(c.parent), /prior_settlement_unknown/);
      await writeFile(join(intent, 'receipt.json'), JSON.stringify(c.result), { mode: 0o600 });
      const before = await Promise.all([
        readFile(join(intent, 'intent.json')),
        readFile(join(intent, 'receipt.json')),
        readFile(join(phase, 'receipt.json')),
      ]);
      await inspectPriorBridgeHandoverSettlement(c.parent);
      assert.deepEqual(
        await Promise.all([
          readFile(join(intent, 'intent.json')),
          readFile(join(intent, 'receipt.json')),
          readFile(join(phase, 'receipt.json')),
        ]),
        before,
      );
      for (const changed of [
        collector, // The previous fabricated collector-shaped wrapper is rejected.
        { ...c.result, extra: 'unknown' },
        { ...c.result, retryAuthorized: true },
        { ...c.result, ambiguousWrite: true },
        { ...c.result, classification: 'PRIVATE_OWNER_COLLECTION_UNQUALIFIED' },
        { ...c.result, appendAttempted: 'true' },
        {
          ...c.result,
          classification:
            collector === stopped ? 'TRUSTED_RELEASE_COLLECT_APPEND_ACK' : 'TRUSTED_RELEASE_COLLECT_STOPPED',
          appendAttempted: collector === stopped,
          appendAcknowledged: collector === stopped,
        },
      ]) {
        await writeFile(join(intent, 'receipt.json'), JSON.stringify(changed), { mode: 0o600 });
        await assert.rejects(inspectPriorBridgeHandoverSettlement(c.parent), /prior_settlement_unknown/);
      }
    } finally {
      await rm(c.parent, { recursive: true, force: true });
    }
  }
});

test('bridge handover reconciles a real launcher timeout only with a closed no-append child', async () => {
  const stopped = {
    ...closed(),
    classification: 'TRUSTED_RELEASE_COLLECT_STOPPED',
    appendAttempted: false,
    appendAcknowledged: false,
  };
  const source = reserveSource.replace(JSON.stringify(operations), JSON.stringify(operations.slice(0, 9)));
  const c = await processControl(
    source +
      `for await(const b of process.stdin){};
      await writeFile(join(phase,'receipt.json'),JSON.stringify(${JSON.stringify(stopped)}),{mode:0o600});
      setInterval(()=>{},1000);`,
    { timeoutMs: 500 },
  );
  try {
    assert.deepEqual(c.result, {
      version: 'm5-owner-trusted-release-launch-v1',
      classification: 'OWNER_PROCESS_TIMEOUT',
      ambiguousWrite: false,
      appendAttempted: false,
      appendAcknowledged: false,
      retryAuthorized: false,
    });
    const phase = join(c.parent, `m5-trusted-release-collector-native-run-20261011-${recordId}`);
    const intent = join(c.parent, `m5-trusted-release-launch-intent-${recordId}`);
    await mkdir(intent, { mode: 0o700 });
    await writeFile(
      join(intent, 'intent.json'),
      JSON.stringify({
        version: 'm5-owner-trusted-release-launch-intent-v1',
        recordId,
        childPhase: phase.split('/').at(-1),
        retryAuthorized: false,
      }),
      { mode: 0o600 },
    );
    await writeFile(join(intent, 'receipt.json'), JSON.stringify(c.result), { mode: 0o600 });
    const before = await Promise.all([readFile(join(intent, 'receipt.json')), readFile(join(phase, 'receipt.json'))]);
    const settled = await inspectPriorBridgeHandoverSettlement(c.parent);
    assert.equal(settled.length, 1);
    assert.equal(required(settled[0]).appendReserved, false);
    assert.deepEqual(
      await Promise.all([readFile(join(intent, 'receipt.json')), readFile(join(phase, 'receipt.json'))]),
      before,
    );
    for (const changed of [
      null,
      { ...stopped, appendAttempted: true },
      { ...stopped, ambiguousWrite: true },
      closed(),
    ]) {
      if (changed) await writeFile(join(phase, 'receipt.json'), JSON.stringify(changed), { mode: 0o600 });
      else await rm(join(phase, 'receipt.json'));
      await assert.rejects(inspectPriorBridgeHandoverSettlement(c.parent), /prior_settlement_unknown/);
    }
    await writeFile(join(phase, 'receipt.json'), JSON.stringify(stopped), { mode: 0o600 });
    for (const changed of [
      { ...c.result, appendAttempted: true },
      { ...c.result, appendAcknowledged: true },
      { ...c.result, ambiguousWrite: true },
      { ...c.result, retryAuthorized: true },
      { ...c.result, appendAttempted: 'false' },
      { ...c.result, extra: 'unknown' },
      { ...c.result, classification: 'OWNER_PROCESS_UNQUALIFIED' },
    ]) {
      await writeFile(join(intent, 'receipt.json'), JSON.stringify(changed), { mode: 0o600 });
      await assert.rejects(inspectPriorBridgeHandoverSettlement(c.parent), /prior_settlement_unknown/);
    }
    await writeFile(join(intent, 'receipt.json'), JSON.stringify(c.result), { mode: 0o600 });
    await rm(phase, { recursive: true });
    await writeCollectorRecords(phase, recordId, operations);
    await writeFile(join(phase, 'receipt.json'), JSON.stringify(stopped), { mode: 0o600 });
    await assert.rejects(inspectPriorBridgeHandoverSettlement(c.parent), /prior_settlement_unknown/);
  } finally {
    await rm(c.parent, { recursive: true, force: true });
  }
});
