import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import { digest, record, text } from './backup-files.mts';
import {
  type DockerBoundary,
  type DockerRow,
  execute,
  fingerprint,
  type InspectorBoundary,
  type InspectorRow,
  readInspectorReadiness,
} from './backup-run.mts';

const mode = text(process.argv[2]),
  path = text(process.argv[3]);
if (mode === 'digest') {
  const before = process.resourceUsage().maxRSS,
    hash = digest(path),
    peak = process.resourceUsage().maxRSS;
  console.log(JSON.stringify({ hash, peakIncreaseKiB: peak - before }));
} else if (mode === 'replica') {
  writeFileSync(join(path, 'replica-pid'), String(process.pid));
  writeFileSync(join(path, 'replica-ready'), 'ready');
  setTimeout(() => {
    writeFileSync(join(path, 'replica-completed'), 'complete');
  }, 500);
} else if (mode === 'readiness') {
  const sockets = new Set<Socket>();
  const socketPath = join(path, 'ready.sock'),
    server = createServer((socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      socket.end('HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\n{"ready":');
    });
  await new Promise<void>((resolve) => server.listen(socketPath, () => resolve()));
  chmodSync(socketPath, 0o600);
  const runtime = join(path, 'runtime');
  mkdirSync(runtime, { mode: 0o700 });
  const row: DockerRow = {
    Id: 'a'.repeat(64),
    Image: `sha256:${'b'.repeat(64)}`,
    Name: '/insignia-production-web',
    Config: { Labels: { 'com.docker.compose.project': 'insignia-production', 'com.docker.compose.service': 'web' } },
    HostConfig: {},
    Mounts: [],
    RestartCount: 0,
    State: { Status: 'running' },
  };
  let starts = 0,
    running = true,
    invocation = 'old';
  const docker: DockerBoundary = {
    inspect: () => row,
    stop() {
      row.State = { Status: 'exited' };
    },
    start() {
      starts++;
      row.State = { Status: 'running' };
    },
  };
  const inspector: InspectorBoundary = {
    inspect: (): InspectorRow => ({
      configSha256: 'c'.repeat(64),
      status: running ? 'running' : 'exited',
      invocation,
      jobs: false,
      socket: running,
    }),
    verifyArtifact() {},
    ready: () => (invocation === 'old' ? true : readInspectorReadiness(socketPath)),
    stop() {
      running = false;
    },
    start() {
      running = true;
      invocation = 'new';
    },
  };
  const config = {
    format: 'insignia-backup-run-v1',
    project: 'insignia-production',
    windowSeconds: 300,
    runtimeDirectory: runtime,
    containers: [
      {
        service: 'web',
        name: row.Name.slice(1),
        id: row.Id,
        imageId: row.Image,
        configSha256: fingerprint(row),
        healthRequired: false,
      },
    ],
    hostInspector: { unit: 'insignia-artwork-inspection.service', configSha256: 'c'.repeat(64) },
  };
  try {
    await assert.rejects(
      execute(config, docker, () => {}, inspector),
      /writer resume needs operator settlement/,
    );
    const journal = readdirSync(runtime).find((name) => /^[a-f0-9-]{36}$/.test(name));
    assert(journal);
    const hold = record(JSON.parse(readFileSync(join(runtime, journal, 'resume-hold.json'), 'utf8')));
    assert.deepEqual(hold.services, ['host-inspector', 'web']);
    console.log(
      JSON.stringify({ held: true, containerStarts: starts, windowClosed: !existsSync(join(runtime, 'window.json')) }),
    );
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
} else throw new Error('Unknown backup review fixture');
