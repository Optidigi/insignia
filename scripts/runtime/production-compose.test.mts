import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { array, object, required, text } from './validation.mts';

// Renders deployment/production/compose.yaml, the single source of the production runtime shape
// (project `insignia`, deploy AC). Synthetic interpolation values only; never starts a service.
const STACK = '/srv/saas/infra/stacks/insignia';
const DATA = '/srv/data/saas/insignia';
const SECRET_VARIABLES = [
  'INSIGNIA_CREDENTIAL_KEY_BASE64',
  'INSIGNIA_CREDENTIAL_KEY_ID',
  'INSIGNIA_PARTNER_ACCESS_TOKEN',
  'POSTGRES_PASSWORD',
  'SHOPIFY_CLIENT_SECRET',
  'SHOPIFY_WEBHOOK_SECRET',
  'SIGNER_DATABASE_URL',
  'WEB_DATABASE_URL',
  'WORKER_DATABASE_URL',
];
const sentinel = (name: string) => `synthetic-${name.toLowerCase()}`;
const source = new URL('../../deployment/production/compose.yaml', import.meta.url);

async function renderer() {
  const directory = await mkdtemp(join(tmpdir(), 'insignia-production-compose-'));
  await writeFile(join(directory, 'compose.yaml'), await readFile(source));
  await writeFile(
    join(directory, 'owner.yaml'),
    await readFile(new URL('../../deployment/m5-runtime/signing-owner-compose.yaml', import.meta.url)),
  );
  const standalone = process.env.INSIGNIA_TEST_COMPOSE_BIN;
  const run = (files: string[], environment: Record<string, string>) =>
    spawnSync(
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
        timeout: 10_000,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, COMPOSE_DISABLE_ENV_FILE: '1', ...environment },
      },
    );
  const secrets = Object.fromEntries(SECRET_VARIABLES.map((name) => [name, sentinel(name)]));
  const render = (files = ['compose.yaml'], extra: Record<string, string> = {}): Record<string, unknown> => {
    const result = run(files, { ...secrets, ...extra });
    assert.equal(result.status, 0, result.stderr);
    return object(JSON.parse(result.stdout));
  };
  return { directory, run, render, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

const mounts = (service: Record<string, unknown>) =>
  array(service.volumes ?? []).map((item) => {
    const { bind, ...volume } = object(item);
    // Compose 2 omits a false create_host_path in JSON; the source text is checked separately.
    if (bind !== undefined) assert.equal(object(bind).create_host_path ?? false, false);
    return { source: text(volume.source), target: text(volume.target), read_only: volume.read_only === true };
  });

test('production compose interpolates only required secrets and fails closed without them', async () => {
  const yaml = await readFile(source, 'utf8');
  const references = [...yaml.matchAll(/\$\{([^}]*)\}/g)].map((match) => required(match[1]));
  assert.ok(
    references.every((reference) => /^[A-Z0-9_]+:\?$/.test(reference)),
    'only required (:?) interpolation',
  );
  assert.deepEqual([...new Set(references.map((reference) => reference.slice(0, -2)))].sort(), SECRET_VARIABLES);
  // No literal credential: every bind is long syntax with host-path creation disabled.
  const body = yaml.replace(/^\s*#.*$/gm, '');
  assert.equal(body.match(/create_host_path: false/g)?.length, body.match(/- type: bind/g)?.length);
  assert.doesNotMatch(body, /create_host_path: true|env_file/);
  const h = await renderer();
  try {
    const { POSTGRES_PASSWORD: _omitted, ...partial } = Object.fromEntries(
      SECRET_VARIABLES.map((name) => [name, sentinel(name)]),
    );
    const missing = h.run(['compose.yaml'], partial);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /POSTGRES_PASSWORD/);
    const rendered = h.render();
    const services = object(rendered.services);
    // Every interpolated value lands only where the source puts it.
    const environment = (name: string) => object(object(services[name]).environment ?? {});
    assert.equal(environment('database').POSTGRES_PASSWORD, sentinel('POSTGRES_PASSWORD'));
    assert.equal(environment('signer').DATABASE_URL, sentinel('SIGNER_DATABASE_URL'));
    assert.equal(environment('web').DATABASE_URL, sentinel('WEB_DATABASE_URL'));
    assert.equal(environment('worker').DATABASE_URL, sentinel('WORKER_DATABASE_URL'));
    for (const name of ['web', 'worker'])
      for (const key of ['INSIGNIA_CREDENTIAL_KEY_BASE64', 'INSIGNIA_CREDENTIAL_KEY_ID', 'SHOPIFY_CLIENT_SECRET'])
        assert.equal(environment(name)[key], sentinel(key), `${name} ${key}`);
    assert.equal(environment('web').SHOPIFY_WEBHOOK_SECRET, sentinel('SHOPIFY_WEBHOOK_SECRET'));
    assert.equal(environment('web').INSIGNIA_PARTNER_ACCESS_TOKEN, sentinel('INSIGNIA_PARTNER_ACCESS_TOKEN'));
  } finally {
    await h.cleanup();
  }
});

test('production compose keeps the live identities, custody paths and service boundaries', async () => {
  const h = await renderer();
  try {
    const rendered = h.render();
    assert.equal(rendered.name, 'insignia');
    assert.equal(rendered.volumes, undefined, 'no named volumes: data lives on the encrypted volume');
    const services = object(rendered.services);
    const service = (name: string) => object(services[name]);
    assert.deepEqual(Object.keys(services).sort(), [
      'database',
      'heartbeat',
      'signer',
      'snapshot',
      'verifier',
      'web',
      'worker',
    ]);
    for (const [name, value] of Object.entries(services)) {
      const item = object(value);
      assert.equal(item.container_name, name === 'snapshot' ? 'insignia-heartbeat-snapshot' : `insignia-${name}`);
      assert.equal(item.restart, 'unless-stopped', name);
      for (const mount of mounts(item))
        assert.ok(
          mount.source.startsWith(`${DATA}/`) || mount.source.startsWith(`${STACK}/secrets/`),
          `${name} ${mount.source}`,
        );
      if (name === 'database') {
        assert.match(text(item.image), /^postgres:18\.6-bookworm@sha256:[a-f0-9]{64}$/);
        continue;
      }
      // Local tags are mutable; deploy tooling records and checks the image ID behind each.
      const repository = name === 'snapshot' ? 'heartbeat' : name;
      assert.match(text(item.image), new RegExp(`^insignia/${repository}:[a-f0-9]{8,40}$`));
      assert.equal(item.pull_policy, 'never', name);
      assert.equal(item.read_only, true, name);
      assert.deepEqual(item.cap_drop, ['ALL'], name);
      assert.deepEqual(item.security_opt, ['no-new-privileges:true'], name);
      assert.equal(item.privileged ?? false, false, name);
    }

    // Database: fixed address above the automatic range; the alias the verifier and collector pin.
    const database = service('database');
    const privateDatabase = object(object(database.networks).private);
    assert.equal(privateDatabase.ipv4_address, '10.0.7.250');
    assert.deepEqual(array(privateDatabase.aliases).sort(), ['database', 'insignia-rewrite-m5-019-database']);
    for (const pinned of ['../../deployment/release-verifier/artifact.mts', '../release/collector-native.mts'])
      assert.match(await readFile(new URL(pinned, import.meta.url), 'utf8'), /'insignia-rewrite-m5-019-database'/);
    assert.deepEqual(mounts(database), [
      { source: `${DATA}/postgres`, target: '/var/lib/postgresql', read_only: false },
    ]);

    // Web: image command, Cloudflare-only routers, signer socket read-only, never the wrapping key.
    const web = service('web');
    const webCommand = (await readFile(new URL('Dockerfile.web', import.meta.url), 'utf8')).match(/^CMD (\[.+\])$/m);
    assert.deepEqual(web.command, JSON.parse(required(webCommand?.[1])));
    assert.equal(web.user, 'node');
    assert.equal(web.init, true);
    assert.equal(web.stop_grace_period, '40s');
    assert.equal(web.ports, undefined);
    assert.deepEqual(Object.keys(object(web.networks)).sort(), ['private', 'proxy']);
    const labels = object(web.labels);
    assert.equal(labels['traefik.enable'], 'true');
    assert.equal(labels['traefik.http.routers.insignia-web.rule'], 'Host(`app.insigniacustomizer.com`)');
    assert.equal(
      labels['traefik.http.routers.insignia-uninstall-private.rule'],
      'Host(`app.insigniacustomizer.com`) && PathPrefix(`/api/webhooks/uninstall/`)',
    );
    const cloudflare = JSON.parse(
      await readFile(new URL('../../deployment/m5-019r/cloudflare-ips.json', import.meta.url), 'utf8'),
    ) as { ipv4: string[]; ipv6: string[] };
    assert.equal(
      labels['traefik.http.middlewares.insignia-cloudflare-origin.ipallowlist.sourcerange'],
      [...cloudflare.ipv4, ...cloudflare.ipv6].join(','),
    );
    assert.ok(!Object.keys(labels).some((key) => key.includes('ipstrategy')), 'match the TCP peer only');
    const routers = Object.keys(labels)
      .map((key) => /^traefik\.http\.routers\.([^.]+)\.rule$/.exec(key)?.[1])
      .filter((name): name is string => name !== undefined);
    assert.deepEqual(routers.sort(), ['insignia-uninstall-private', 'insignia-web']);
    for (const router of routers)
      assert.equal(labels[`traefik.http.routers.${router}.middlewares`], 'insignia-cloudflare-origin', router);
    assert.ok(!JSON.stringify(labels).includes('optidigi'));
    assert.deepEqual(
      mounts(web).find((mount) => mount.target === '/run/insignia/signer'),
      { source: `${DATA}/runtime-state/signer-socket`, target: '/run/insignia/signer', read_only: true },
    );
    assert.ok(mounts(web).every((mount) => mount.read_only));

    // Signer: the only holder of the wrapping key; private network only; no port, route or TCP listener.
    const signer = service('signer');
    assert.deepEqual(signer.command, ['/usr/local/bin/node', '/srv/insignia/worker/dist/signer-main.js']);
    assert.equal(signer.user, '10101:1000');
    assert.deepEqual(Object.keys(object(signer.networks)), ['private']);
    assert.equal(signer.ports, undefined);
    assert.equal(signer.labels, undefined);
    assert.deepEqual(Object.keys(object(signer.environment)).sort(), ['DATABASE_URL', 'NODE_ENV']);
    assert.deepEqual(mounts(signer), [
      {
        source: `${STACK}/secrets/signing-wrap-keys.json`,
        target: '/run/insignia/signing-wrap-keys.json',
        read_only: true,
      },
      { source: `${DATA}/runtime-state/signer-socket`, target: '/run/insignia/signer', read_only: false },
    ]);
    for (const [name, value] of Object.entries(services)) {
      if (name === 'signer') continue;
      assert.ok(!JSON.stringify(value).includes('signing-wrap-keys'), name);
      assert.ok(!JSON.stringify(value).includes('INSIGNIA_SIGNING_WRAP'), name);
    }

    // Worker: outbound bridge plus private network; health only on host loopback for the heartbeat.
    const worker = service('worker');
    const workerCommand = (await readFile(new URL('../worker/Dockerfile', import.meta.url), 'utf8')).match(
      /^CMD (\[.+\])$/m,
    );
    assert.deepEqual(worker.command, JSON.parse(required(workerCommand?.[1])));
    assert.equal(worker.user, 'node');
    assert.deepEqual(Object.keys(object(worker.networks)).sort(), ['private', 'worker-egress']);
    assert.deepEqual(
      array(worker.ports).map((port) => {
        const { host_ip, published, target, protocol } = object(port);
        return { host_ip, published, target, protocol };
      }),
      [{ host_ip: '127.0.0.1', published: '9464', target: 4301, protocol: 'tcp' }],
    );
    assert.equal(object(worker.environment).INSIGNIA_WORKER_HEALTH_HOST, '0.0.0.0');
    assert.deepEqual(mounts(worker), [
      { source: `${DATA}/runtime-state/m5-verify`, target: '/run/insignia/release-verification', read_only: true },
    ]);

    // Verifier: one profile across web, worker and verifier, bound to a committed release binding.
    const verifier = service('verifier');
    const command = array(verifier.command).map(text);
    assert.equal(command.length, 3);
    assert.equal(command[0], '--manifest-sha256');
    assert.match(required(command[1]), /^[a-f0-9]{64}$/);
    const profile = required(command[2]);
    assert.equal(object(web.environment).INSIGNIA_RELEASE_PROFILE, profile);
    assert.equal(object(worker.environment).INSIGNIA_RELEASE_PROFILE, profile);
    const runtime = new URL('../../deployment/m5-runtime/', import.meta.url);
    const bindings = await Promise.all(
      (await readdir(runtime))
        .filter((name) => name.endsWith('-release-binding.json'))
        .map(async (name) => object(JSON.parse(await readFile(new URL(name, runtime), 'utf8'))).versionTag),
    );
    assert.ok(bindings.includes(profile), `no committed release binding for ${profile}`);
    assert.equal(verifier.user, '1000:1000');
    assert.equal(verifier.ports, undefined);
    assert.deepEqual(Object.keys(object(verifier.networks)).sort(), ['private', 'verifier-egress']);
    assert.deepEqual(mounts(verifier), [
      {
        source: `${STACK}/secrets/verifier-startup.json`,
        target: '/run/insignia/verifier-startup.json',
        read_only: true,
      },
      { source: `${DATA}/runtime-state/verifier-state`, target: '/var/lib/insignia/verifier', read_only: false },
      { source: `${DATA}/runtime-state/verifier-auth`, target: '/var/lib/insignia/verifier-auth', read_only: false },
      { source: `${DATA}/runtime-state/m5-verify`, target: '/run/insignia/release-verification', read_only: false },
    ]);

    // Monitor: host network (worker loopback probe, database at 10.0.7.250); only the snapshot writes aggregates.
    for (const name of ['heartbeat', 'snapshot']) {
      assert.equal(service(name).network_mode, 'host');
      assert.equal(service(name).user, '1000:1000');
    }
    assert.deepEqual(
      mounts(service('snapshot')).filter((mount) => !mount.read_only),
      [{ source: `${DATA}/monitor/aggregates`, target: '/run/insignia/aggregates', read_only: false }],
    );
    assert.ok(mounts(service('heartbeat')).every((mount) => mount.read_only));

    const networks = object(rendered.networks);
    const subnet = (name: string) => object(array(object(object(networks[name]).ipam).config)[0]).subnet;
    assert.equal(object(networks.private).internal, true);
    assert.equal(subnet('private'), '10.0.7.0/24');
    assert.equal(subnet('worker-egress'), '10.0.8.0/24');
    assert.equal(subnet('verifier-egress'), '10.0.9.0/24');
    assert.equal(object(networks['worker-egress']).internal ?? false, false);
    assert.deepEqual(
      { external: object(networks.proxy).external, name: object(networks.proxy).name },
      { external: true, name: 'proxy' },
    );
  } finally {
    await h.cleanup();
  }
});

test('the owner signing overlay on the production stack adds only its two web mounts', async () => {
  const h = await renderer();
  try {
    const plan = join(h.directory, 'plan.json'),
      runRoot = join(h.directory, 'private-journal');
    const ordinary = h.render();
    const owner = h.render(['compose.yaml', 'owner.yaml'], {
      INSIGNIA_SIGNING_OWNER_PLAN: plan,
      INSIGNIA_SIGNING_OWNER_RUN_ROOT: runRoot,
    });
    const { web: ownerWeb, ...ownerOthers } = object(owner.services);
    const { web: ordinaryWeb, ...ordinaryOthers } = object(ordinary.services);
    assert.deepEqual(ownerOthers, ordinaryOthers);
    assert.deepEqual(owner.networks, ordinary.networks);
    const { volumes: ownerVolumes, ...ownerRest } = object(ownerWeb);
    const { volumes: ordinaryVolumes, ...ordinaryRest } = object(ordinaryWeb);
    assert.deepEqual(ownerRest, ordinaryRest);
    const before = mounts({ volumes: ordinaryVolumes });
    assert.deepEqual(mounts({ volumes: ownerVolumes }), [
      ...before,
      { source: plan, target: '/run/insignia/signing-owner-plan.json', read_only: true },
      { source: runRoot, target: '/var/lib/insignia/signing-owner', read_only: false },
    ]);
    assert.ok(!JSON.stringify(ownerOthers).includes(plan));
  } finally {
    await h.cleanup();
  }
});
