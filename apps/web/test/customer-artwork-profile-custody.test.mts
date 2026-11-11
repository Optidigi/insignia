import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { loadCustomerArtworkEmailProfile } from '../../worker/src/customer-artwork-email-profile.ts';
import { loadCustomerEmailQualification } from '../src/server/customer-artwork/notification-qualification.ts';

const sender = {
  version: 'cloudflare-customer-artwork-email-v1',
  accountId: 'a'.repeat(32),
  apiToken: 'synthetic-custody-only',
  from: 'noreply@insigniacustomizer.com',
  appOrigin: 'https://insignia.test',
  mode: 'development',
};
const grant = {
  version: 'customer-artwork-email-qualification-v1',
  accountId: sender.accountId,
  appOrigin: sender.appOrigin,
  sender: sender.from,
  arbitraryRecipients: true,
  protectedOrderEmail: true,
  qualifiedAt: '2026-11-05T12:00:00Z',
  providerEvidenceRef: 'owned/provider',
  recipientEvidenceRef: 'owned/recipient',
  tenantScopes: [{ shopId: 'shop', installationGeneration: '1', appClientId: 'app' }],
};
test('source and relocated compiled loaders honor explicit artifact boundaries and reject parent symlink aliases', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'insignia-email-custody-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const artifactRoot = join(temporary, 'web'),
    privateRoot = join(temporary, 'web-private');
  await mkdir(join(artifactRoot, 'dist/server'), { recursive: true });
  await mkdir(privateRoot, { mode: 0o700 });
  const profileFile = join(privateRoot, 'sender.json'),
    grantFile = join(privateRoot, 'grant.json');
  await writeFile(profileFile, JSON.stringify(sender), { mode: 0o600 });
  await writeFile(grantFile, JSON.stringify(grant), { mode: 0o600 });
  const expected = { appOrigin: sender.appOrigin, accountId: sender.accountId, artifactRoot };
  const grantExpected = { ...expected, appClientId: 'app' };
  assert.equal((await loadCustomerArtworkEmailProfile(profileFile, expected)).from, sender.from);
  assert.equal((await loadCustomerEmailQualification(grantFile, grantExpected)).tenantScopes[0]?.shopId, 'shop');
  const inside = join(artifactRoot, 'private-sender.json');
  await copyFile(profileFile, inside);
  await assert.rejects(loadCustomerArtworkEmailProfile(inside, expected), /PROFILE_UNAVAILABLE/);
  const alias = join(temporary, 'alias');
  await symlink(privateRoot, alias, 'dir');
  await assert.rejects(loadCustomerArtworkEmailProfile(join(alias, 'sender.json'), expected), /PROFILE_UNAVAILABLE/);
  await assert.rejects(
    loadCustomerEmailQualification(join(alias, 'grant.json'), grantExpected),
    /QUALIFICATION_UNAVAILABLE/,
  );
  await symlink(profileFile, join(privateRoot, 'symlink.json'));
  await assert.rejects(
    loadCustomerArtworkEmailProfile(join(privateRoot, 'symlink.json'), expected),
    /PROFILE_UNAVAILABLE/,
  );
  const moved = join(artifactRoot, 'dist/server/moved-profile.mjs');
  await copyFile(new URL('../../worker/dist/customer-artwork-email-profile.js', import.meta.url), moved);
  const compiled = (await import(pathToFileURL(moved).href)) as {
    loadCustomerArtworkEmailProfile: typeof loadCustomerArtworkEmailProfile;
  };
  assert.equal((await compiled.loadCustomerArtworkEmailProfile(profileFile, expected)).from, sender.from);
  await assert.rejects(compiled.loadCustomerArtworkEmailProfile(inside, expected), /PROFILE_UNAVAILABLE/);
  await assert.rejects(
    compiled.loadCustomerArtworkEmailProfile(join(alias, 'sender.json'), expected),
    /PROFILE_UNAVAILABLE/,
  );
  const emitted = await build({
    entryPoints: [new URL('../src/server/customer-artwork/notification-qualification.ts', import.meta.url).pathname],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  const output = emitted.outputFiles[0];
  assert(output);
  const grantModule = join(artifactRoot, 'dist/server/moved-grant.mjs');
  await writeFile(grantModule, output.text);
  const compiledGrant = (await import(pathToFileURL(grantModule).href)) as {
    loadCustomerEmailQualification: typeof loadCustomerEmailQualification;
  };
  assert.equal((await compiledGrant.loadCustomerEmailQualification(grantFile, grantExpected)).sender, sender.from);
  await assert.rejects(
    compiledGrant.loadCustomerEmailQualification(join(alias, 'grant.json'), grantExpected),
    /QUALIFICATION_UNAVAILABLE/,
  );
  await assert.rejects(
    compiled.loadCustomerArtworkEmailProfile(profileFile, { ...expected, artifactRoot: '/' }),
    /PROFILE_UNAVAILABLE/,
  );
  const checkout = join(temporary, 'checkout');
  await mkdir(join(checkout, 'apps/web'), { recursive: true });
  await writeFile(join(checkout, 'pnpm-workspace.yaml'), 'packages: []');
  const misplaced = join(checkout, 'credential.json');
  await copyFile(profileFile, misplaced);
  await assert.rejects(
    loadCustomerArtworkEmailProfile(misplaced, { ...expected, artifactRoot: join(checkout, 'apps/web') }),
    /PROFILE_UNAVAILABLE/,
  );
});
