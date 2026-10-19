import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { record, text } from './backup-files.mts';
import {
  type Configuration,
  type Container,
  Docker,
  type DockerBoundary,
  type DockerRow,
  execute,
  fingerprint,
  type InspectorBoundary,
  type InspectorRow,
  verifyInspectorArtifact,
} from './backup-run.mts';

function cleanEnvironment() {
  const original = { ...process.env };
  for (const name of ['PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR', 'PGOPTIONS', 'DATABASE_URL'])
    delete process.env[name];
  return () => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, original);
  };
}
function directory() {
  return mkdtempSync('/dev/shm/insignia-exclusion-');
}
function row(service = 'web', project = 'insignia-production', id = 'a'.repeat(64)): DockerRow {
  return {
    Id: id,
    Image: `sha256:${'b'.repeat(64)}`,
    Name: `/${project}-${service}`,
    Config: { Labels: { 'com.docker.compose.project': project, 'com.docker.compose.service': service } },
    HostConfig: {},
    Mounts: [],
    RestartCount: 0,
    State: { Status: 'running' },
  };
}
function item(source: DockerRow, service = 'web', project?: string): Container {
  return {
    service,
    name: source.Name.slice(1),
    id: source.Id,
    imageId: source.Image,
    configSha256: fingerprint(source),
    healthRequired: false,
    ...(project ? { project } : {}),
  };
}
function config(runtime: string, containers: Container[]): Configuration {
  return {
    format: 'insignia-backup-run-v1',
    project: 'insignia-production',
    containers,
    runtimeDirectory: runtime,
    windowSeconds: 300,
  };
}
function required<T>(value: T | undefined): T {
  assert(value !== undefined);
  return value;
}
function launcher(path: string, fixture: URL, directory: string) {
  for (const value of [process.execPath, fixture.pathname, directory]) assert(!value.includes("'"));
  writeFileSync(path, `#!/bin/sh\nexec '${process.execPath}' '${fixture.pathname}' '${directory}' "$@"\n`, {
    mode: 0o700,
  });
}

test('host inspector drains before capture and recovers before containers; uncertainty and drift hold exact writers', async () => {
  const restore = cleanEnvironment();
  try {
    for (const failure of [
      undefined,
      'capture',
      'stop',
      'ready',
      'identity',
      'reactivation',
      'inactive',
      'jobs',
      'prestop-restart',
    ]) {
      const runtime = directory(),
        actions: string[] = [],
        source = row();
      let running = failure !== 'inactive',
        invocation = 'old';
      const docker: DockerBoundary = {
        inspect: () => source,
        stop() {
          actions.push('web-stop');
          source.State = { Status: 'exited' };
          if (failure === 'prestop-restart') invocation = 'replacement';
        },
        start() {
          actions.push('web-start');
          source.State = { Status: 'running' };
        },
      };
      const inspector: InspectorBoundary = {
        inspect: (): InspectorRow => ({
          status: running ? 'running' : 'exited',
          invocation,
          configSha256: (failure === 'identity' ? 'd' : 'c').repeat(64),
          jobs: failure === 'jobs',
          socket: running,
        }),
        ready: () => running && !(failure === 'ready' && invocation === 'new'),
        verifyArtifact() {},
        stop() {
          actions.push('inspector-stop');
          if (failure === 'stop') throw new Error('unknown inspector stop');
          running = false;
        },
        start() {
          actions.push('inspector-start');
          running = true;
          invocation = 'new';
        },
      };
      const settings = {
        ...config(runtime, [item(source)]),
        hostInspector: { unit: 'insignia-artwork-inspection.service', configSha256: 'c'.repeat(64) },
      };
      const work = async (_window: string, stopped: () => Promise<void>) => {
        actions.push('capture');
        assert(!running);
        assert.equal(source.State.Status, 'exited');
        if (failure === 'reactivation') running = true;
        await stopped();
        if (failure === 'capture') throw new Error('snapshot failed');
      };
      try {
        if (failure === undefined || failure === 'inactive') await execute(settings, docker, work, inspector);
        else await assert.rejects(execute(settings, docker, work, inspector));
        assert(!existsSync(join(runtime, 'window.json')));
        if (failure === 'identity' || failure === 'jobs') assert.deepEqual(actions, []);
        else if (failure === 'inactive') assert.deepEqual(actions, ['web-stop', 'capture', 'web-start']);
        else if (failure === 'stop') {
          assert(!actions.includes('capture'));
          assert(!actions.includes('inspector-start'));
        } else if (failure === 'ready') assert(!actions.includes('web-start'));
        else if (failure === 'reactivation') {
          assert(!actions.includes('inspector-start'));
          assert(!actions.includes('web-start'));
        } else if (failure === 'prestop-restart') assert.deepEqual(actions, ['web-stop']);
        else assert.deepEqual(actions, ['web-stop', 'inspector-stop', 'capture', 'inspector-start', 'web-start']);
      } finally {
        rmSync(runtime, { recursive: true, force: true });
      }
    }
  } finally {
    restore();
  }
});

test('deployed split projects exclude together while a foreign project fails before any stop', async () => {
  const restore = cleanEnvironment(),
    runtime = directory();
  try {
    const rows = new Map<string, DockerRow>([
        ['web', row('web', 'insignia-rewrite-m5-019', '1'.repeat(64))],
        ['worker', row('worker', 'insignia-uninstall-m5-024', '2'.repeat(64))],
        ['verifier', row('verifier', 'insignia-release-verifier', '3'.repeat(64))],
      ]),
      actions: [string, string][] = [];
    const docker: DockerBoundary = {
      inspect: (item) => required(rows.get(item.service)),
      stop(item) {
        actions.push(['stop', item.service]);
        required(rows.get(item.service)).State = { Status: 'exited' };
      },
      start(item) {
        actions.push(['start', item.service]);
        required(rows.get(item.service)).State = { Status: 'running' };
      },
    };
    const containers = [...rows].map(([service, row]) =>
      item(row, service, text(record(row.Config.Labels)['com.docker.compose.project'])),
    );
    const settings = config(runtime, containers),
      first = required(containers[0]);
    await assert.rejects(
      execute(
        { ...settings, containers: [{ ...first, project: 'insignia-other' }, ...containers.slice(1)] },
        docker,
        () => {},
      ),
    );
    assert.deepEqual(actions, []);
    await execute(settings, docker, async (window, stopped) => {
      assert(existsSync(window));
      await stopped();
      assert([...rows.values()].every((row) => row.State.Status === 'exited'));
    });
    assert.deepEqual(actions, [
      ['stop', 'web'],
      ['stop', 'worker'],
      ['stop', 'verifier'],
      ['start', 'verifier'],
      ['start', 'worker'],
      ['start', 'web'],
    ]);
    assert(!existsSync(join(runtime, 'window.json')));
  } finally {
    restore();
    rmSync(runtime, { recursive: true, force: true });
  }
});

test('identity drift has no stop; failed work resumes only originally running writers', async () => {
  const restore = cleanEnvironment(),
    runtime = directory();
  try {
    const web = row(),
      worker = row('worker', 'insignia-production', 'c'.repeat(64));
    worker.State = { Status: 'exited' };
    const rows = new Map([
        ['web', web],
        ['worker', worker],
      ]),
      actions: [string, string][] = [];
    const docker: DockerBoundary = {
      inspect: (item) => required(rows.get(item.service)),
      stop(item) {
        actions.push(['stop', item.service]);
        required(rows.get(item.service)).State = { Status: 'exited' };
      },
      start(item) {
        actions.push(['start', item.service]);
        required(rows.get(item.service)).State = { Status: 'running' };
      },
    };
    const containers = [item(web), item(worker, 'worker')];
    const settings = config(runtime, containers);
    await assert.rejects(
      execute(
        {
          ...settings,
          containers: [{ ...required(containers[0]), configSha256: '0'.repeat(64) }, required(containers[1])],
        },
        docker,
        () => {},
      ),
    );
    assert.deepEqual(actions, []);
    await assert.rejects(
      execute(settings, docker, () => {
        throw new Error('capture failed');
      }),
      /capture failed/,
    );
    assert.deepEqual(actions, [
      ['stop', 'web'],
      ['start', 'web'],
    ]);
    assert(!existsSync(join(runtime, 'window.json')));
  } finally {
    restore();
    rmSync(runtime, { recursive: true, force: true });
  }
});

test('a second real process refuses durable interruption or uncertain stop after runtime recreation', () => {
  const restore = cleanEnvironment();
  try {
    for (const mode of ['interrupt', 'uncertain-stop', 'inspector-interrupt', 'inspector-uncertain-stop']) {
      const root = directory(),
        runtime = join(root, 'runtime'),
        receipts = join(root, 'receipts');
      mkdirSync(runtime, { mode: 0o700 });
      mkdirSync(receipts, { mode: 0o700 });
      try {
        const source = row();
        writeFileSync(join(root, 'state.json'), JSON.stringify(source));
        launcher(join(root, 'docker'), new URL('./backup-docker.fixture.mts', import.meta.url), root);
        const settings = {
          ...config(runtime, [item(source)]),
          receiptDirectory: receipts,
          ...(mode.startsWith('inspector-')
            ? { hostInspector: { unit: 'insignia-artwork-inspection.service', configSha256: 'c'.repeat(64) } }
            : {}),
        };
        writeFileSync(join(root, 'config.json'), JSON.stringify(settings));
        if (mode === 'uncertain-stop') writeFileSync(join(root, 'uncertain'), '');
        const fixture = new URL('./backup-crash.fixture.mts', import.meta.url).pathname;
        const first = spawnSync(process.execPath, [fixture, root, mode], { encoding: 'utf8', timeout: 10000 });
        assert.notEqual(first.status, 0);
        assert.equal(readFileSync(join(root, 'actions'), 'utf8'), 'stop\n');
        rmSync(runtime, { recursive: true });
        mkdirSync(runtime, { mode: 0o700 });
        const second = spawnSync(process.execPath, [fixture, root, mode, '--retry'], {
          encoding: 'utf8',
          timeout: 10000,
        });
        assert.notEqual(second.status, 0);
        assert.match(second.stderr, /prior writer operation requires reconciliation/);
        assert.equal(readFileSync(join(root, 'actions'), 'utf8'), 'stop\n');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  } finally {
    restore();
  }
});

test('actual Docker client arguments never force kill and an unclean exit remains unsettled', async () => {
  const root = directory();
  try {
    const source = row(),
      container = item(source);
    writeFileSync(join(root, 'state.json'), JSON.stringify(source));
    launcher(join(root, 'docker'), new URL('./backup-docker.fixture.mts', import.meta.url), root);
    const docker = new Docker(join(root, 'docker'));
    await docker.stop(container);
    writeFileSync(join(root, 'unclean'), '');
    await assert.rejects(docker.stop(container), /drain/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('changed inspector bootstrap and runtime reject even when the manifest is unchanged', () => {
  const root = directory();
  try {
    mkdirSync(join(root, 'bin'), { mode: 0o700 });
    writeFileSync(join(root, 'start.mjs'), 'qualified bootstrap', { mode: 0o400 });
    writeFileSync(join(root, 'bin/node'), 'qualified runtime', { mode: 0o500 });
    const files = Object.fromEntries(
      [
        ['start.mjs', 0o400],
        ['bin/node', 0o500],
      ].map(([name, mode]) => {
        assert(typeof name === 'string' && typeof mode === 'number');
        return [
          name,
          {
            kind: 'file',
            mode,
            sha256: createHash('sha256')
              .update(readFileSync(join(root, name)))
              .digest('hex'),
          },
        ];
      }),
    );
    const raw = JSON.stringify({ version: 'insignia-artwork-inspector-artifact-v1', files });
    writeFileSync(join(root, 'manifest.json'), raw);
    const hash = createHash('sha256').update(raw).digest('hex');
    verifyInspectorArtifact(root, hash);
    for (const [name, mode] of [
      ['start.mjs', 0o400],
      ['bin/node', 0o500],
    ] as const) {
      const path = join(root, name),
        original = readFileSync(path);
      chmodSync(path, 0o600);
      writeFileSync(path, 'tampered');
      chmodSync(path, mode);
      assert.throws(() => verifyInspectorArtifact(root, hash), /artifact/);
      chmodSync(path, 0o600);
      writeFileSync(path, original);
      chmodSync(path, mode);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('alternate libpq authority rejects before any Docker read or effect', async () => {
  const restore = cleanEnvironment();
  try {
    const forbidden = () => {
      throw new Error('Docker must not be called');
    };
    for (const name of ['PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR', 'PGOPTIONS', 'DATABASE_URL']) {
      process.env[name] = 'forbidden';
      await assert.rejects(
        execute({}, { inspect: forbidden, stop: forbidden, start: forbidden }, () => {}),
        /alternate source database authority/,
      );
      delete process.env[name];
    }
  } finally {
    restore();
  }
});

test('SIGTERM during capture closes admission and resumes acknowledged original writers before process exit', {
  timeout: 15000,
}, async () => {
  const restore = cleanEnvironment(),
    root = directory(),
    runtime = join(root, 'runtime'),
    receipts = join(root, 'receipts');
  mkdirSync(runtime, { mode: 0o700 });
  mkdirSync(receipts, { mode: 0o700 });
  const source = row();
  writeFileSync(join(root, 'state.json'), JSON.stringify(source));
  launcher(join(root, 'docker'), new URL('./backup-docker.fixture.mts', import.meta.url), root);
  writeFileSync(
    join(root, 'config.json'),
    JSON.stringify({ ...config(runtime, [item(source)]), receiptDirectory: receipts }),
  );
  const child = spawn(process.execPath, [new URL('./backup-interrupt.fixture.mts', import.meta.url).pathname, root], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const [ready] = await once(child.stdout, 'data');
    assert.equal(String(ready), 'CAPTURE_READY');
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const [code] = await exited;
    assert.notEqual(code, 0);
    assert.equal(readFileSync(join(root, 'actions'), 'utf8'), 'stop\nstart\n');
    assert(!existsSync(join(runtime, 'window.json')));
    const journal = readdirSync(receipts).find((name) => /^[a-f0-9-]{36}$/.test(name));
    assert(journal);
    assert.equal(
      record(JSON.parse(readFileSync(join(receipts, journal, 'resumed.json'), 'utf8'))).readiness,
      'ORIGINAL_WRITERS_RESUMED',
    );
  } finally {
    child.kill('SIGKILL');
    restore();
    rmSync(root, { recursive: true, force: true });
  }
});
