import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  assembleDatabaseFixtureProbe,
  assembleImageInventoryProbe,
  finalizeImageFixture,
  qualifyFixtureDatabase,
  qualifyImageConfiguration,
  qualifyImageRuntime,
  runImageCommand,
} from './image-observations.mjs';

test('failed fixture logs make qualification fail while both owned cleanups still execute', async () => {
  // External Docker CLI boundary fixture only; this never qualifies a real image.
  const result = await finalizeImageFixture({
    containerNames: ['worker', 'database'],
    cleanupCommands: [
      ['rm', 'worker'],
      ['rm', 'database'],
    ],
    async run(args, options) {
      const child = await runImageCommand(
        process.execPath,
        ['-e', "if(process.argv[1]==='logs')process.exit(7); console.log('owned-cleanup')", ...args],
        options,
      );
      assert.equal(child.code, 0);
      assert.match(child.stdout, /owned-cleanup/);
    },
  });
  assert.equal(result.status, 'FAIL');
  assert.deepEqual(
    result.logs.map((log) => [log.name, log.status]),
    [
      ['worker', 'FAIL'],
      ['database', 'FAIL'],
    ],
  );
  assert.deepEqual(
    result.cleanup.map((item) => item.status),
    ['PASS', 'PASS'],
  );
});

test('a cancelled fixture child is killed and awaited before its late work can run', async () => {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 100);
  try {
    const result = await runImageCommand(
      process.execPath,
      ['-e', "setTimeout(()=>console.log('late-database-work'),300)"],
      { signal: abort.signal, timeout: 1000 },
    );
    assert.equal(result.aborted, true);
    assert.equal(result.signal, 'SIGKILL');
    assert.ok(!result.stdout.includes('late-database-work'));
  } finally {
    clearTimeout(timer);
  }
});

test('command deadline kills a hanging fixture and an expired signal launches no work', async () => {
  const result = await runImageCommand(process.execPath, ['-e', 'setTimeout(()=>{},300)'], { timeout: 20 });
  assert.equal(result.timedOut, true);
  assert.equal(result.signal, 'SIGKILL');
  await assert.rejects(
    runImageCommand(process.execPath, ['-e', "console.log('must-not-launch')"], { signal: AbortSignal.abort() }),
    { name: 'AbortError' },
  );
});

test('a Node test deadline reaches finalization after cancelling its in-flight child', async () => {
  const helper = new URL('./image-observations.mjs', import.meta.url).href;
  const program = `
import { test } from 'node:test';
import { runImageCommand } from ${JSON.stringify(helper)};
test('synthetic database wait', { timeout: 80 }, async t => {
  try {
    await runImageCommand(process.execPath, ['-e', 'setTimeout(()=>{},1000)'], { signal: t.signal });
  } finally { console.log('finalization-after-cancelled-child'); }
});`;
  const child = await runImageCommand(process.execPath, ['--input-type=module', '-e', program], { timeout: 700 });
  assert.equal(child.code, 1, 'the nested timeout is an expected negative, not a passing runtime test');
  assert.equal(child.timedOut, false, 'the deadline must cancel work rather than keep the child alive');
  assert.match(child.stdout, /finalization-after-cancelled-child/);
});

test('the exact assembled inventory and bounded database programs parse before execution', () => {
  const source = readFileSync(
    new URL('../../docs/delivery/evidence/m5-023/operators/worker-inventory.mjs', import.meta.url),
    'utf8',
  );
  for (const program of [assembleImageInventoryProbe(source), assembleDatabaseFixtureProbe()]) {
    const child = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: program, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
  }
});

const imageId = `sha256:${'a'.repeat(64)}`;

function databaseObservation() {
  // Minimal actual attempt1 no-binding/address shape; IDs/names are synthetic here.
  const containerId = 'c'.repeat(64);
  const networkId = 'd'.repeat(64);
  return {
    expectedContainerId: containerId,
    expectedName: 'owned-db',
    expectedNetworkId: networkId,
    expectedNetworkName: 'owned-net',
    container: {
      Id: containerId,
      Name: '/owned-db',
      HostConfig: { PortBindings: {}, PublishAllPorts: false },
      NetworkSettings: {
        Ports: {},
        Networks: { 'owned-net': { NetworkID: networkId, IPAddress: '172.19.0.2', IPPrefixLen: 16 } },
      },
    },
    network: {
      Id: networkId,
      Name: 'owned-net',
      Driver: 'bridge',
      Internal: true,
      EnableIPv6: false,
      IPAM: { Config: [{ Subnet: '172.19.0.0/16', Gateway: '172.19.0.1' }] },
      Containers: { [containerId]: { Name: 'owned-db', IPv4Address: '172.19.0.2/16' } },
    },
  };
}

test('fixture provisioning selects only the exact owned internal DB address without published ports', () => {
  assert.equal(
    qualifyFixtureDatabase(databaseObservation()),
    'postgres://insignia_test:synthetic-owner@172.19.0.2:5432/insignia_image_test?sslmode=disable',
  );
});

test('fixture provisioning rejects requested/actual publication, foreign identity/network and unsafe address/subnet drift', () => {
  const mutations = [
    (v) => {
      v.container.HostConfig.PortBindings = { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '' }] };
    }, // actual attempt1 request
    (v) => {
      v.container.NetworkSettings.Ports = { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '5432' }] };
    },
    (v) => {
      v.container.HostConfig.PublishAllPorts = true;
    },
    (v) => {
      v.container.Id = 'e'.repeat(64);
    },
    (v) => {
      v.container.Name = '/foreign-db';
    },
    (v) => {
      v.network.Id = 'e'.repeat(64);
    },
    (v) => {
      v.network.Name = 'foreign-net';
    },
    (v) => {
      v.network.Internal = false;
    },
    (v) => {
      v.network.Driver = 'overlay';
    },
    (v) => {
      v.network.EnableIPv6 = true;
    },
    (v) => {
      v.container.NetworkSettings.Networks.extra = { NetworkID: 'foreign' };
    },
    (v) => {
      v.container.NetworkSettings.Networks['owned-net'].NetworkID = 'foreign';
    },
    (v) => {
      v.network.Containers[v.expectedContainerId].IPv4Address = '172.19.0.3/16';
    },
    (v) => {
      v.network.IPAM.Config[0].Subnet = '172.20.0.0/16';
    },
    (v) => {
      v.network.IPAM.Config[0].Subnet = '172.19.0.0/8';
    },
    (v) => {
      v.container.NetworkSettings.Networks['owned-net'].IPPrefixLen = 24;
    },
  ];
  for (const address of [
    '8.8.8.8',
    '127.0.0.1',
    '169.254.1.2',
    '::1',
    'fixture-db',
    '172.19.0.2@evil',
    '172.19.0.0',
    '172.19.255.255',
    '172.19.0.1',
    '10.0.0.2',
  ])
    mutations.push((v) => {
      v.container.NetworkSettings.Networks['owned-net'].IPAddress = address;
    });
  for (const mutate of mutations) {
    const value = databaseObservation();
    mutate(value);
    assert.throws(() => qualifyFixtureDatabase(value));
  }
});
function observation() {
  return {
    imageId,
    container: {
      Image: imageId,
      Path: '/usr/local/bin/node',
      Args: ['/srv/insignia/worker/dist/main.js'],
      Config: { User: 'node' },
      HostConfig: {
        ReadonlyRootfs: true,
        Privileged: false,
        CapDrop: ['ALL'],
        CapAdd: null,
        SecurityOpt: ['no-new-privileges:true'],
        PortBindings: {},
      },
      Mounts: [],
      NetworkSettings: { Networks: { isolated: { NetworkID: 'network-id' } } },
    },
    network: { Id: 'network-id', Internal: true, EnableIPv6: false },
    process: {
      argv: ['/usr/local/bin/node', '/srv/insignia/worker/dist/main.js'],
      uid: [1000, 1000, 1000, 1000],
      gid: [1000, 1000, 1000, 1000],
      capabilities: [
        '0000000000000000',
        '0000000000000000',
        '0000000000000000',
        '0000000000000000',
        '0000000000000000',
      ],
      noNewPrivileges: 1,
      rootWriteError: 'EROFS',
      defaultRoute: false,
      externalConnect: false,
      nodeExecutableSha256: 'frozen-node-hash',
    },
    inventory: { node: 'v24.21.0', nodeExecutableSha256: 'frozen-node-hash', packages: [{ name: '@insignia/worker' }] },
    expectedInventory: {
      node: 'v24.21.0',
      nodeExecutableSha256: 'frozen-node-hash',
      packages: [{ name: '@insignia/worker' }],
    },
  };
}

test('image qualification rejects a writable root even with otherwise restricted runtime observations', () => {
  const value = observation();
  value.container.HostConfig.ReadonlyRootfs = false;
  assert.throws(() => qualifyImageRuntime(value), /root filesystem/);
});

test('image qualification requires the frozen executable and actual OS isolation', () => {
  assert.doesNotThrow(() => qualifyImageRuntime(observation()));
  const failures = [
    (v) => {
      v.container.Image = `sha256:${'b'.repeat(64)}`;
    },
    (v) => {
      v.inventory.packages[0].name = 'unreviewed';
    },
    (v) => {
      v.process.nodeExecutableSha256 = 'unreviewed';
    },
    (v) => {
      v.process.uid = [0, 0, 0, 0];
    },
    (v) => {
      v.process.capabilities[1] = '0000000000000001';
    },
    (v) => {
      v.process.noNewPrivileges = 0;
    },
    (v) => {
      v.process.rootWriteError = null;
    },
    (v) => {
      v.process.argv.unshift('/bin/sh');
    },
    (v) => {
      v.container.Path = '/bin/sh';
    },
    (v) => {
      v.container.HostConfig.CapAdd = ['NET_ADMIN'];
    },
    (v) => {
      v.container.HostConfig.SecurityOpt = [];
    },
    (v) => {
      v.container.HostConfig.Privileged = true;
    },
    (v) => {
      v.container.Mounts = [{ Destination: '/srv/insignia/worker' }];
    },
    (v) => {
      v.container.HostConfig.PortBindings = { '4301/tcp': [{}] };
    },
    (v) => {
      v.network.Internal = false;
    },
    (v) => {
      v.network.EnableIPv6 = true;
    },
    (v) => {
      v.container.NetworkSettings.Networks.extra = { NetworkID: 'external' };
    },
    (v) => {
      v.process.defaultRoute = true;
    },
    (v) => {
      v.process.externalConnect = true;
    },
  ];
  for (const mutate of failures) {
    const value = observation();
    mutate(value);
    assert.throws(() => qualifyImageRuntime(value));
  }
});

test('image launcher rejects an inherited entrypoint wrapper and accepts direct Node', () => {
  const image = {
    Config: {
      User: 'node',
      Cmd: ['/usr/local/bin/node', '/srv/insignia/worker/dist/main.js'],
      Entrypoint: ['docker-entrypoint.sh'],
    },
  };
  assert.throws(() => qualifyImageConfiguration(image));
  image.Config.Entrypoint = [];
  assert.doesNotThrow(() => qualifyImageConfiguration(image));
});
