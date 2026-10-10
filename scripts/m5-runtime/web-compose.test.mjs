import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { collectWorkerInventory } from '../../docs/delivery/evidence/m5-023/operators/worker-inventory.mjs';
import { qualifyWorkerCandidate } from '../m5-024/worker-guards.mjs';

// Required CI control: invokes the real renderer, never starts a service or contacts production.
test('ordinary runtime overlays preserve canonical web boundaries and restrict worker outbound topology', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'insignia-web-compose-'));
  const image = `sha256:${'a'.repeat(64)}`;
  try {
    await writeFile(
      join(directory, 'base.yaml'),
      await readFile(new URL('../../deployment/m5-019r/compose.yaml', import.meta.url)),
    );
    await writeFile(
      join(directory, 'overlay.yaml'),
      await readFile(new URL('../../deployment/m5-runtime/compose.yaml', import.meta.url)),
    );
    // Empty web inputs satisfy env_file lookup; worker values below are synthetic local controls.
    await writeFile(join(directory, 'runtime.env'), '');
    await writeFile(join(directory, 'database.env'), '');
    const workerEnvironment = {
      DATABASE_URL: 'postgres://synthetic_worker@database:5432/synthetic_db?sslmode=disable',
      SHOPIFY_CLIENT_ID: 'synthetic-client',
      SHOPIFY_CLIENT_SECRET: 'synthetic-hmac',
      SHOPIFY_WEBHOOK_SECRET: 'synthetic-hmac',
      INSIGNIA_CREDENTIAL_KEY_ID: 'synthetic-k1',
      INSIGNIA_CREDENTIAL_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
      NODE_ENV: 'production',
    };
    await writeFile(
      join(directory, 'worker.env'),
      Object.entries(workerEnvironment)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n'),
    );
    await writeFile(
      join(directory, 'worker-base.yaml'),
      await readFile(new URL('../m5-024/worker-compose.yaml', import.meta.url)),
    );
    await writeFile(
      join(directory, 'worker-overlay.yaml'),
      await readFile(new URL('../../deployment/m5-runtime/worker-compose.yaml', import.meta.url)),
    );
    const render = (files) =>
      JSON.parse(
        execFileSync(
          'docker',
          ['compose', ...files.flatMap((file) => ['-f', join(directory, file)]), 'config', '--format', 'json'],
          {
            cwd: directory,
            env: {
              PATH: process.env.PATH,
              HOME: process.env.HOME,
              COMPOSE_DISABLE_ENV_FILE: '1',
              INSIGNIA_WEB_IMAGE: image,
              INSIGNIA_WORKER_IMAGE: image,
              INSIGNIA_ROUTE_ENABLED: 'true',
            },
            encoding: 'utf8',
            timeout: 10_000,
            maxBuffer: 4 * 1024 * 1024,
          },
        ),
      );
    const base = render(['base.yaml']);
    const candidate = render(['base.yaml', 'overlay.yaml']);
    assert.equal(candidate.name, 'insignia-rewrite-m5-019');
    assert.deepEqual(Object.keys(candidate.services).sort(), Object.keys(base.services).sort());
    assert.deepEqual(candidate.services.database, base.services.database);
    assert.deepEqual(candidate.networks, base.networks);
    assert.deepEqual(candidate.volumes, base.volumes);
    const web = candidate.services.web;
    assert.equal(web.image, image);
    assert.equal(web.init, true);
    assert.equal(web.user, 'node');
    assert.equal(web.read_only, true);
    assert.equal(web.pull_policy, 'never');
    assert.deepEqual(web.command, ['/usr/local/bin/node', '/srv/insignia/web/dist/server/entry.mjs']);
    const dockerfile = await readFile(new URL('./Dockerfile.web', import.meta.url), 'utf8');
    const imageCommand = dockerfile.match(/^CMD (\[.+\])$/m);
    assert.ok(imageCommand, 'qualified Dockerfile must retain its direct JSON Node command');
    assert.deepEqual(web.command, JSON.parse(imageCommand[1]));
    assert.deepEqual(web.cap_drop, ['ALL']);
    assert.deepEqual(web.security_opt, ['no-new-privileges:true']);
    assert.equal(web.stop_grace_period, '40s');
    assert.equal(web.privileged ?? false, false);
    assert.equal(web.ports, undefined);
    assert.equal(web.volumes, undefined);
    assert.deepEqual(web.labels, base.services.web.labels);
    assert.equal(web.labels['traefik.enable'], 'true');
    assert.equal(
      web.labels['traefik.http.routers.insignia-canonical-m5-019r.rule'],
      'Host(`insignia-app.optidigi.nl`)',
    );
    const intentional = new Set([
      'image',
      'init',
      'user',
      'command',
      'stop_grace_period',
      'read_only',
      'cap_drop',
      'security_opt',
      'pull_policy',
    ]);
    const inherited = (service) => Object.fromEntries(Object.entries(service).filter(([key]) => !intentional.has(key)));
    assert.deepEqual(inherited(web), inherited(base.services.web));
    const workerBase = render(['worker-base.yaml']);
    const workerCandidate = render(['worker-base.yaml', 'worker-overlay.yaml']);
    assert.equal(workerCandidate.name, 'insignia-uninstall-m5-024');
    assert.deepEqual(Object.keys(workerCandidate.services), ['worker']);
    assert.deepEqual(workerCandidate.networks.private, workerBase.networks.private);
    // Compose versions can emit an empty IPAM object for an unconfigured network.
    const withoutEmptyIpam = ({ ipam, ...network }) => {
      if (ipam !== undefined) assert.deepEqual(ipam, {});
      return network;
    };
    assert.deepEqual(withoutEmptyIpam(workerCandidate.networks.private), {
      name: 'insignia-rewrite-m5-019_private',
      external: true,
    });
    // Compose's omitempty serializer may omit the false default.
    assert.equal(workerCandidate.networks.egress.internal ?? false, false);
    const { internal: _internal, ...egress } = withoutEmptyIpam(workerCandidate.networks.egress);
    assert.deepEqual(egress, { name: 'insignia-uninstall-m5-024_egress', driver: 'bridge' });
    assert.deepEqual(Object.keys(workerCandidate.networks).sort(), ['egress', 'private']);
    assert.deepEqual(workerCandidate.volumes, workerBase.volumes);
    const worker = workerCandidate.services.worker;
    assert.equal(worker.image, image);
    assert.equal(worker.user, 'node');
    assert.equal(worker.read_only, true);
    assert.equal(worker.privileged ?? false, false);
    assert.equal(worker.ports, undefined);
    assert.equal(worker.volumes, undefined);
    assert.deepEqual(worker.command, ['/usr/local/bin/node', '/srv/insignia/worker/dist/main.js']);
    assert.deepEqual(worker.cap_drop, ['ALL']);
    assert.deepEqual(worker.security_opt, ['no-new-privileges:true']);
    assert.deepEqual(worker.networks, { private: null, egress: null });
    const withoutNetworks = ({ networks: _networks, ...service }) => service;
    assert.deepEqual(withoutNetworks(worker), withoutNetworks(workerBase.services.worker));
    // Exercise the actual JSON through the guard rather than a hand-written render fixture.
    const endpoint = {
      hostname: 'database',
      port: 5432,
      database: 'synthetic_db',
      role: 'synthetic_worker',
      sslmode: 'disable',
      address: 'synthetic-address',
      major: 18,
      schemaVersion: 43,
    };
    const webEndpoint = { ...endpoint, role: 'synthetic_web' };
    const entry = fileURLToPath(new URL('../../apps/worker/dist/main.js', import.meta.url));
    const inventory = collectWorkerInventory(entry);
    const composeBytes = Buffer.concat([
      await readFile(join(directory, 'worker-base.yaml')),
      await readFile(join(directory, 'worker-overlay.yaml')),
    ]);
    assert.equal(
      qualifyWorkerCandidate({
        composeBytes,
        composeSha256: createHash('sha256').update(composeBytes).digest('hex'),
        rendered: workerCandidate,
        expectedRendered: workerCandidate,
        environment: worker.environment,
        webEnvironment: {
          ...workerEnvironment,
          DATABASE_URL: 'postgres://synthetic_web@database:5432/synthetic_db?sslmode=disable',
        },
        endpoint,
        expectedEndpoint: endpoint,
        webEndpoint,
        expectedWebEndpoint: webEndpoint,
        entry,
        inventory,
        writablePaths: [],
        image,
        expectedImage: image,
      }),
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
