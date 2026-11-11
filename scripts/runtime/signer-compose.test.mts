import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { object } from './validation.mts';

// Renders the real overlays; never starts a service or contacts production.
test('signer overlay: only the signer holds the wrapping key; web reaches it only through a read-only socket directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'insignia-signer-compose-'));
  const image = `sha256:${'b'.repeat(64)}`;
  try {
    for (const [name, source] of [
      ['base.yaml', '../../deployment/m5-019r/compose.yaml'],
      ['overlay.yaml', '../../deployment/m5-runtime/compose.yaml'],
      ['signer.yaml', '../../deployment/m5-runtime/signer-compose.yaml'],
    ] as const)
      await writeFile(join(directory, name), await readFile(new URL(source, import.meta.url)));
    for (const name of ['runtime.env', 'database.env', 'signer.env']) await writeFile(join(directory, name), '');
    const rendered = object(
      JSON.parse(
        execFileSync(
          'docker',
          ['compose', '-f', 'base.yaml', '-f', 'overlay.yaml', '-f', 'signer.yaml', 'config', '--format', 'json'],
          {
            cwd: directory,
            env: {
              PATH: process.env.PATH,
              HOME: process.env.HOME,
              COMPOSE_DISABLE_ENV_FILE: '1',
              INSIGNIA_WEB_IMAGE: `sha256:${'a'.repeat(64)}`,
              INSIGNIA_WORKER_IMAGE: image,
              INSIGNIA_SIGNING_WRAP_KEY_FILE: '/srv/private/signing-wrap-keys.json',
              INSIGNIA_SIGNER_SOCKET_DIRECTORY: '/srv/private/signer',
            },
            encoding: 'utf8',
            timeout: 10_000,
          },
        ),
      ),
    );
    const services = object(rendered.services);
    assert.deepEqual(Object.keys(services).sort(), ['database', 'signer', 'web']);
    const signer = object(services.signer);
    const web = object(services.web);
    assert.equal(signer.image, image);
    assert.deepEqual(signer.command, ['/usr/local/bin/node', '/srv/insignia/worker/dist/signer-main.js']);
    assert.equal(signer.user, 'node');
    assert.equal(signer.read_only, true);
    assert.deepEqual(signer.cap_drop, ['ALL']);
    assert.deepEqual(signer.security_opt, ['no-new-privileges:true']);
    // No proxy network, published port, route labels or TCP listener configuration.
    assert.deepEqual(Object.keys(object(signer.networks)), ['private']);
    assert.equal(signer.ports, undefined);
    assert.equal(signer.labels, undefined);
    assert.equal(object(signer.environment).PORT, undefined);
    const mounts = (service: Record<string, unknown>) =>
      (service.volumes as Record<string, unknown>[] | undefined)?.map((volume) => ({
        source: volume.source,
        target: volume.target,
        read_only: volume.read_only ?? false,
      })) ?? [];
    assert.deepEqual(mounts(signer), [
      {
        source: '/srv/private/signing-wrap-keys.json',
        target: '/run/insignia/signing-wrap-keys.json',
        read_only: true,
      },
      { source: '/srv/private/signer', target: '/run/insignia/signer', read_only: false },
    ]);
    // Web: the socket directory only, read-only; never the key file; no wrapping-key variables.
    assert.deepEqual(mounts(web), [{ source: '/srv/private/signer', target: '/run/insignia/signer', read_only: true }]);
    assert.ok(!JSON.stringify(web).includes('signing-wrap-keys'));
    assert.ok(!Object.keys(object(web.environment)).some((key) => key.startsWith('INSIGNIA_SIGNING_WRAP')));
    assert.ok(!JSON.stringify(signer.environment).includes('INSIGNIA_SIGNING_WRAP'));
    assert.deepEqual(object(signer.environment), { NODE_ENV: 'production' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
