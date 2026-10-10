import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { collectWorkerInventory } from '../../docs/delivery/evidence/m5-023/operators/worker-inventory.mjs';
import { qualifyWorkerCandidate } from './worker-guards.mjs';

// Actual package graph required, supplied only by offline qualification or explicit CI build.
test('candidate guards reject source, Compose, image, endpoint and private parity drift', {
  skip: !process.env.M5_WORKER_PACKAGE_ENTRY,
}, () => {
  const entry = process.env.M5_WORKER_PACKAGE_ENTRY;
  const rendered = {
    services: {
      worker: {
        image: `synthetic@sha256:${'a'.repeat(64)}`,
        read_only: true,
        user: 'node',
        command: ['/usr/local/bin/node', '/srv/insignia/worker/dist/main.js'],
        cap_drop: ['ALL'],
        security_opt: ['no-new-privileges:true'],
        networks: ['private'],
      },
    },
  };
  const composeBytes = Buffer.from('synthetic reviewed worker compose');
  const environment = {
    DATABASE_URL: 'postgres://synthetic_worker@database:5432/synthetic_db?sslmode=disable',
    SHOPIFY_CLIENT_ID: 'synthetic-client',
    SHOPIFY_CLIENT_SECRET: 'synthetic-hmac',
    SHOPIFY_WEBHOOK_SECRET: 'synthetic-hmac',
    INSIGNIA_CREDENTIAL_KEY_ID: 'synthetic-k1',
    INSIGNIA_CREDENTIAL_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
    NODE_ENV: 'production',
  };
  const endpoint = {
    hostname: 'database',
    port: 5432,
    database: 'synthetic_db',
    role: 'synthetic_worker',
    sslmode: 'disable',
    address: '127.0.0.1',
    major: 18,
    schemaVersion: 43,
  };
  const candidate = {
    composeBytes,
    composeSha256: createHash('sha256').update(composeBytes).digest('hex'),
    rendered,
    expectedRendered: rendered,
    environment,
    webEnvironment: {
      ...environment,
      DATABASE_URL: environment.DATABASE_URL.replace('synthetic_worker', 'synthetic_web'),
    },
    endpoint,
    expectedEndpoint: endpoint,
    webEndpoint: { ...endpoint, role: 'synthetic_web' },
    expectedWebEndpoint: { ...endpoint, role: 'synthetic_web' },
    entry,
    inventory: collectWorkerInventory(entry),
    writablePaths: [],
    image: `synthetic@sha256:${'a'.repeat(64)}`,
    expectedImage: `synthetic@sha256:${'a'.repeat(64)}`,
  };
  assert.equal(qualifyWorkerCandidate(candidate), true);
  // docker image save/load preserves this content-addressed ID without a RepoDigest.
  const localImage = `sha256:${'b'.repeat(64)}`;
  const localRendered = {
    ...rendered,
    services: { worker: { ...rendered.services.worker, image: localImage } },
  };
  const localCandidate = {
    ...candidate,
    rendered: localRendered,
    expectedRendered: localRendered,
    image: localImage,
    expectedImage: localImage,
  };
  assert.equal(qualifyWorkerCandidate(localCandidate), true);
  const outboundRendered = {
    ...localRendered,
    name: 'insignia-uninstall-m5-024',
    services: { worker: { ...localRendered.services.worker, networks: { private: null, egress: null } } },
    networks: {
      private: { external: true, name: 'insignia-rewrite-m5-019_private' },
      egress: { name: 'insignia-uninstall-m5-024_egress', driver: 'bridge', internal: false },
    },
  };
  const outboundCandidate = { ...localCandidate, rendered: outboundRendered, expectedRendered: outboundRendered };
  assert.equal(qualifyWorkerCandidate(outboundCandidate), true);
  const serializedRendered = {
    ...outboundRendered,
    services: { worker: { ...outboundRendered.services.worker, entrypoint: null } },
    networks: {
      private: { ...outboundRendered.networks.private, ipam: {} },
      egress: { name: 'insignia-uninstall-m5-024_egress', driver: 'bridge', ipam: {} },
    },
  };
  assert.equal(
    qualifyWorkerCandidate({
      ...outboundCandidate,
      rendered: serializedRendered,
      expectedRendered: serializedRendered,
    }),
    true,
  );
  for (const networks of [
    undefined,
    { ...outboundRendered.networks, egress: { ...outboundRendered.networks.egress, internal: true } },
    { ...outboundRendered.networks, egress: { ...outboundRendered.networks.egress, internal: null } },
    { ...outboundRendered.networks, egress: { ...outboundRendered.networks.egress, ipam: { driver: 'unreviewed' } } },
    { ...outboundRendered.networks, private: { ...outboundRendered.networks.private, ipam: { config: [{}] } } },
    { ...outboundRendered.networks, egress: { ...outboundRendered.networks.egress, external: true } },
    { ...outboundRendered.networks, egress: { ...outboundRendered.networks.egress, name: 'unowned' } },
    { ...outboundRendered.networks, private: { external: true, name: 'wrong_database_network' } },
    { ...outboundRendered.networks, proxy: { external: true } },
  ]) {
    const drift = { ...outboundRendered, networks };
    assert.equal(qualifyWorkerCandidate({ ...outboundCandidate, rendered: drift, expectedRendered: drift }), false);
  }
  assert.equal(qualifyWorkerCandidate({ ...outboundCandidate, expectedRendered: localRendered }), false);
  for (const entrypoint of [[], ['/bin/sh'], 'node']) {
    const drift = {
      ...serializedRendered,
      services: { worker: { ...serializedRendered.services.worker, entrypoint } },
    };
    assert.equal(qualifyWorkerCandidate({ ...outboundCandidate, rendered: drift, expectedRendered: drift }), false);
  }
  const extraAttachment = {
    ...outboundRendered,
    services: {
      worker: { ...outboundRendered.services.worker, networks: { private: null, egress: { aliases: ['unreviewed'] } } },
    },
  };
  assert.equal(
    qualifyWorkerCandidate({ ...outboundCandidate, rendered: extraAttachment, expectedRendered: extraAttachment }),
    false,
  );
  assert.equal(qualifyWorkerCandidate({ ...localCandidate, expectedImage: candidate.image }), false);
  for (const image of ['sha256:short', `sha256:${'B'.repeat(64)}`, `sha256:${'b'.repeat(63)}`, 'worker:latest']) {
    const unqualifiedRendered = {
      services: { worker: { ...localRendered.services.worker, image } },
    };
    assert.equal(
      qualifyWorkerCandidate({
        ...localCandidate,
        rendered: unqualifiedRendered,
        expectedRendered: unqualifiedRendered,
        image,
        expectedImage: image,
      }),
      false,
    );
  }
  assert.equal(
    qualifyWorkerCandidate({
      ...localCandidate,
      environment: { ...environment, NODE_OPTIONS: '--import=evil' },
    }),
    false,
  );
  const tlsCandidate = {
    ...candidate,
    endpoint: { ...endpoint, sslmode: 'verify-full' },
    expectedEndpoint: { ...endpoint, sslmode: 'verify-full' },
    webEndpoint: { ...candidate.webEndpoint, sslmode: 'verify-full' },
    expectedWebEndpoint: { ...candidate.webEndpoint, sslmode: 'verify-full' },
    environment: { ...environment, DATABASE_URL: environment.DATABASE_URL.replace('disable', 'verify-full') },
    webEnvironment: {
      ...candidate.webEnvironment,
      DATABASE_URL: candidate.webEnvironment.DATABASE_URL.replace('disable', 'verify-full'),
    },
  };
  assert.equal(qualifyWorkerCandidate(tlsCandidate), true);
  for (const [key, value] of [
    ['NODE_TLS_REJECT_UNAUTHORIZED', '0'],
    ['NODE_EXTRA_CA_CERTS', '/synthetic/unreviewed-ca.pem'],
    ['SSL_CERT_FILE', '/synthetic/unreviewed-ca.pem'],
    ['SSL_CERT_DIR', '/synthetic/unreviewed-ca'],
    ['OPENSSL_CONF', '/synthetic/unreviewed.conf'],
  ])
    assert.equal(
      qualifyWorkerCandidate({
        ...tlsCandidate,
        webEnvironment: { ...tlsCandidate.webEnvironment, [key]: value },
      }),
      false,
    );
  for (const key of ['environment', 'webEnvironment']) {
    for (const modes of ['verify-full&sslmode=disable', 'disable&sslmode=verify-full']) {
      assert.equal(
        qualifyWorkerCandidate({
          ...tlsCandidate,
          [key]: { ...tlsCandidate[key], DATABASE_URL: tlsCandidate[key].DATABASE_URL.replace('verify-full', modes) },
        }),
        false,
      );
    }
  }
  for (const change of [
    { composeBytes: Buffer.from('drift') },
    { image: `wrong@sha256:${'a'.repeat(64)}` },
    { rendered: { ...rendered, volumes: ['mutable-code:/srv/insignia/worker'] } },
    { rendered: { services: { worker: { ...rendered.services.worker, ports: ['4301:4301'] } } } },
    {
      rendered: {
        services: { worker: { ...rendered.services.worker, networks: ['proxy'], extra_hosts: ['database:evil'] } },
      },
    },
    { endpoint: { ...endpoint, address: '192.0.2.42' } },
    { endpoint: { ...endpoint, schemaVersion: 42 } },
    { environment: { ...environment, PGHOST: 'wrong' } },
    { environment: { ...environment, NODE_OPTIONS: '--import=evil' } },
    { environment: { ...environment, DATABASE_URL: `${environment.DATABASE_URL}&options=evil` } },
    { environment: { ...environment, SHOPIFY_WEBHOOK_SECRET: 'wrong' } },
    { environment: { ...environment, SHOPIFY_WEBHOOK_PREVIOUS_SECRET: 'unmatched-previous' } },
    { environment: { ...environment, INSIGNIA_CREDENTIAL_KEY_BASE64: 'invalid' } },
    { webEnvironment: { ...candidate.webEnvironment, SHOPIFY_CLIENT_SECRET: 'wrong' } },
    { webEnvironment: { ...candidate.webEnvironment, DATABASE_URL: undefined } },
    {
      webEnvironment: {
        ...candidate.webEnvironment,
        DATABASE_URL: 'postgres://synthetic_web@other-db:5432/other_db?sslmode=disable',
      },
    },
    { webEndpoint: undefined },
    { webEndpoint: { ...candidate.webEndpoint, address: '192.0.2.42' } },
    {
      webEnvironment: {
        ...candidate.webEnvironment,
        DATABASE_URL: candidate.webEnvironment.DATABASE_URL.replace(':5432', ''),
        PGPORT: '5433',
      },
    },
    { writablePaths: [entry] },
    { inventory: { ...candidate.inventory, node: 'wrong' } },
  ])
    assert.equal(qualifyWorkerCandidate({ ...candidate, ...change }), false);
});
