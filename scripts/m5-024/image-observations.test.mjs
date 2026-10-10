import assert from 'node:assert/strict';
import { test } from 'node:test';
import { qualifyImageConfiguration, qualifyImageRuntime } from './image-observations.mjs';

const imageId = `sha256:${'a'.repeat(64)}`;
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
