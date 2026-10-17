import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dockerAvailable = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;
test('independent verifier Compose exposes only a private metadata socket and keeps identity/credentials outside web authority', {
  skip: !dockerAvailable && 'Docker Compose is supplied by runtime CI',
}, () => {
  const result = spawnSync(
    'docker',
    ['compose', '-f', 'deployment/release-verifier/compose.yaml', 'config', '--format', 'json'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        INSIGNIA_VERIFIER_IMAGE: `sha256:${'a'.repeat(64)}`,
        INSIGNIA_VERIFIER_MANIFEST_SHA256: 'b'.repeat(64),
        INSIGNIA_VERIFIER_STARTUP_FILE: '/private/startup.json',
        INSIGNIA_VERIFIER_STATE_DIRECTORY: '/private/state',
        INSIGNIA_VERIFIER_AUTH_DIRECTORY: '/private/auth',
        INSIGNIA_RELEASE_VERIFICATION_SOCKET_DIRECTORY: '/private/socket',
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const model = JSON.parse(result.stdout),
    service = model.services.verifier;
  assert.deepEqual(Object.keys(model.services), ['verifier']);
  assert.equal(service.user, '1000:1000');
  assert.equal(service.read_only, true);
  assert.deepEqual(service.cap_drop, ['ALL']);
  assert.deepEqual(service.security_opt, ['no-new-privileges:true']);
  assert.ok(!service.ports && !service.privileged && !service.pid && !service.network_mode);
  assert.deepEqual(service.command, ['--manifest-sha256', 'b'.repeat(64), 'lean-markets-7b17cd9']);
  assert.equal(service.volumes.length, 4);
  assert.equal(service.volumes.find((v) => v.target === '/run/insignia/verifier-startup.json').read_only, true);
  // compose-go versions using json:",omitempty" omit the false bool. Keep the
  // explicit source policy as well, so serialization cannot hide missing authority guards.
  const source = readFileSync('deployment/release-verifier/compose.yaml', 'utf8');
  assert.equal([...source.matchAll(/^\s+create_host_path: false\s*$/gm)].length, 4);
  assert.ok(
    service.volumes.every(
      (v) =>
        v.type === 'bind' &&
        (v.bind?.create_host_path === false || v.bind?.create_host_path === undefined) &&
        !/docker.sock|\.ssh|wrapping|artwork-storage/.test(v.source),
    ),
  );
  assert.deepEqual(Object.keys(service.networks).sort(), ['egress', 'private']);
});
