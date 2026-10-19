import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { array, object } from './validation.mts';

test('owner overlay adds only fixed plan/journal mounts to the immutable ordinary command', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'signing-compose-'));
  try {
    for (const [name, relative] of [
      ['base.yaml', '../../deployment/m5-019r/compose.yaml'],
      ['ordinary.yaml', '../../deployment/m5-runtime/compose.yaml'],
      ['owner.yaml', '../../deployment/m5-runtime/signing-owner-compose.yaml'],
      ['collector.yaml', '../../deployment/m5-runtime/release-verification-compose.yaml'],
      ['worker-base.yaml', '../worker/worker-compose.yaml'],
      ['worker-runtime.yaml', '../../deployment/m5-runtime/worker-compose.yaml'],
      ['worker-collector.yaml', '../../deployment/m5-runtime/release-verification-worker-compose.yaml'],
    ] as const)
      await writeFile(join(directory, name), await readFile(new URL(relative, import.meta.url)));
    await writeFile(join(directory, 'runtime.env'), '');
    await writeFile(join(directory, 'database.env'), '');
    await writeFile(join(directory, 'worker.env'), '');
    const standalone = process.env.INSIGNIA_TEST_COMPOSE_BIN;
    const render = (files: string[]): Record<string, unknown> =>
      object(
        JSON.parse(
          execFileSync(
            standalone ?? 'docker',
            [
              ...(standalone ? [] : ['compose']),
              ...files.flatMap((file) => ['-f', join(directory, file)]),
              'config',
              '--format',
              'json',
            ],
            {
              cwd: directory,
              encoding: 'utf8',
              timeout: 10000,
              env: {
                PATH: process.env.PATH,
                HOME: process.env.HOME,
                COMPOSE_DISABLE_ENV_FILE: '1',
                INSIGNIA_WEB_IMAGE: `sha256:${'a'.repeat(64)}`,
                INSIGNIA_WORKER_IMAGE: `sha256:${'b'.repeat(64)}`,
                INSIGNIA_SIGNING_OWNER_PLAN: join(directory, 'plan.json'),
                INSIGNIA_SIGNING_OWNER_RUN_ROOT: join(directory, 'private-journal'),
                INSIGNIA_RELEASE_VERIFICATION_SOCKET_DIRECTORY: join(directory, 'private-collector-bridge'),
              },
            },
          ),
        ),
      );
    // Compose2 omits false; Compose5 retains it. Both must preserve the
    // explicit source prohibition and may not introduce any extra bind key.
    const normalizedBinds = (volumes: unknown) =>
      array(volumes).map((item) => {
        const { bind: bindInput, ...volume } = object(item);
        const bind = object(bindInput);
        assert.ok(bind && Object.keys(bind).every((key) => key === 'create_host_path'));
        assert.equal(bind.create_host_path ?? false, false);
        return { ...volume, bind: { create_host_path: false } };
      });
    const ordinary = render(['base.yaml', 'ordinary.yaml']),
      owner = render(['base.yaml', 'ordinary.yaml', 'owner.yaml']);
    const coordinated = render(['base.yaml', 'ordinary.yaml', 'owner.yaml', 'collector.yaml']);
    assert.deepEqual(Object.keys(object(coordinated.services)).sort(), Object.keys(object(ordinary.services)).sort());
    const workerOrdinary = render(['worker-base.yaml', 'worker-runtime.yaml']);
    const workerCoordinated = render(['worker-base.yaml', 'worker-runtime.yaml', 'worker-collector.yaml']);
    assert.deepEqual(Object.keys(object(workerCoordinated.services)), ['worker']);
    const { volumes: workerVolumes, ...workerService } = object(object(workerCoordinated.services).worker);
    assert.deepEqual(workerService, object(object(workerOrdinary.services).worker));
    assert.deepEqual(workerCoordinated.networks, workerOrdinary.networks);
    assert.deepEqual(workerCoordinated.volumes, workerOrdinary.volumes);
    assert.deepEqual(normalizedBinds(workerVolumes), [
      {
        type: 'bind',
        source: join(directory, 'private-collector-bridge'),
        target: '/run/insignia/release-verification',
        read_only: true,
        bind: { create_host_path: false },
      },
    ]);
    const collectorSource = await readFile(join(directory, 'collector.yaml'), 'utf8');
    assert.equal(collectorSource.match(/create_host_path: false/g)?.length, 1);
    const workerSource = await readFile(join(directory, 'worker-collector.yaml'), 'utf8');
    assert.equal(workerSource.match(/create_host_path: false/g)?.length, 1);
    assert.deepEqual(object(object(coordinated.services).database), object(object(ordinary.services).database));
    assert.deepEqual(coordinated.networks, ordinary.networks);
    const { volumes: coordinatedVolumes, ...coordinatedWeb } = object(object(coordinated.services).web);
    const { volumes: ownerVolumes, ...ownerWeb } = object(object(owner.services).web);
    assert.deepEqual(coordinatedWeb, ownerWeb);
    assert.deepEqual(array(coordinatedVolumes).slice(0, array(ownerVolumes).length), ownerVolumes);
    assert.deepEqual(normalizedBinds([array(coordinatedVolumes).at(-1)])[0], {
      type: 'bind',
      source: join(directory, 'private-collector-bridge'),
      target: '/run/insignia/release-verification',
      read_only: true,
      bind: { create_host_path: false },
    });
    assert.deepEqual(object(object(owner.services).database), object(object(ordinary.services).database));
    assert.deepEqual(owner.networks, ordinary.networks);
    const { volumes, ...web } = object(object(owner.services).web);
    assert.deepEqual(web, object(object(ordinary.services).web));
    // Qualified Compose 2.39.4 omits false create_host_path in JSON (bind:{}).
    // Check explicit source plus renderer semantics; never accept true/extra keys.
    const ownerSource = await readFile(join(directory, 'owner.yaml'), 'utf8');
    assert.equal(ownerSource.match(/create_host_path: false/g)?.length, 2);
    const normalized = normalizedBinds(volumes);
    assert.deepEqual(normalized, [
      {
        type: 'bind',
        source: join(directory, 'plan.json'),
        target: '/run/insignia/signing-owner-plan.json',
        read_only: true,
        bind: { create_host_path: false },
      },
      {
        type: 'bind',
        source: join(directory, 'private-journal'),
        target: '/var/lib/insignia/signing-owner',
        bind: { create_host_path: false },
      },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
