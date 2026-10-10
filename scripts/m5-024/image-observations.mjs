import assert from 'node:assert/strict';

export function qualifyImageConfiguration(image) {
  assert.deepEqual(image.Config.Cmd, ['/usr/local/bin/node', '/srv/insignia/worker/dist/main.js']);
  assert.deepEqual(image.Config.Entrypoint ?? [], [], 'direct Node launcher requires no inherited entrypoint');
  assert.equal(image.Config.User, 'node');
}

// Qualification of native Docker/Linux observations, never a substitute for collecting them.
export function qualifyImageRuntime({ imageId, container, network, process, inventory, expectedInventory }) {
  const command = ['/usr/local/bin/node', '/srv/insignia/worker/dist/main.js'];
  assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(container.Image, imageId, 'built image identity');
  assert.deepEqual(inventory, expectedInventory, 'frozen package and Node inventory');
  assert.equal(inventory.node, 'v24.21.0');
  assert.equal(process.nodeExecutableSha256, inventory.nodeExecutableSha256, 'PID1 executable identity');
  assert.equal(container.Config.User, 'node');
  assert.equal(container.Path, command[0]);
  assert.deepEqual(container.Args, command.slice(1));
  assert.deepEqual(process.argv, command, 'direct Node PID1');
  assert.deepEqual(process.uid, [1000, 1000, 1000, 1000], 'nonroot PID1');
  assert.deepEqual(process.gid, [1000, 1000, 1000, 1000]);
  assert.equal(container.HostConfig.ReadonlyRootfs, true, 'read-only root filesystem required');
  assert.equal(process.rootWriteError, 'EROFS', 'actual root filesystem write denial');
  assert.equal(container.HostConfig.Privileged, false);
  assert.deepEqual(container.HostConfig.CapDrop, ['ALL']);
  assert.deepEqual(container.HostConfig.CapAdd ?? [], []);
  assert.deepEqual(container.HostConfig.SecurityOpt, ['no-new-privileges:true']);
  assert.deepEqual(process.capabilities, Array(5).fill('0000000000000000'), 'PID1 capability sets');
  assert.equal(process.noNewPrivileges, 1);
  assert.deepEqual(container.Mounts, [], 'no executable or writable mounts');
  assert.deepEqual(container.HostConfig.PortBindings ?? {}, {}, 'no published worker ports');
  assert.equal(network.Internal, true);
  assert.equal(network.EnableIPv6, false, 'this qualification requires IPv4-only network');
  const networks = Object.values(container.NetworkSettings.Networks);
  assert.equal(networks.length, 1);
  assert.equal(networks[0].NetworkID, network.Id);
  assert.equal(process.defaultRoute, false);
  assert.equal(process.externalConnect, false);
}
