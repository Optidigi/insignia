import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';

// Chrome denies Web Storage to a cross-site iframe when third-party cookies are blocked (incognito default):
// the property getter itself throws. Shopify App Store requirement 1.1.1 needs the admin to keep working.
function denyingWindow() {
  const target = {} as Record<string, unknown>;
  for (const name of ['sessionStorage', 'localStorage'])
    Object.defineProperty(target, name, {
      get() {
        throw new DOMException(`Failed to read the '${name}' property from 'Window': Access is denied`, 'SecurityError');
      },
    });
  return target;
}

test('blocked Web Storage falls back to one in-memory store per kind for the page', async () => {
  (globalThis as { window?: unknown }).window = denyingWindow();
  const { sessionStore, localStore } = await import(`../../src/shared/browser-storage.ts?blocked`);
  const session = sessionStore();
  session.setItem('journal', 'pending');
  assert.equal(sessionStore().getItem('journal'), 'pending');
  assert.equal(sessionStore(), session);
  assert.notEqual(localStore(), session);
  assert.equal(localStore().getItem('journal'), null);
  session.removeItem('journal');
  assert.equal(session.length, 0);
});

test('available Web Storage is used directly and the probe leaves nothing behind', async () => {
  const { memoryStorage } = await import(`../../src/shared/browser-storage.ts?memory`);
  const real = memoryStorage();
  (globalThis as { window?: unknown }).window = { sessionStorage: real, localStorage: memoryStorage() };
  const { sessionStore } = await import(`../../src/shared/browser-storage.ts?available`);
  assert.equal(sessionStore(), real);
  assert.equal(real.length, 0);
});

test('admin code reads Web Storage only through browser-storage or inside guarded best-effort helpers', async () => {
  // Each listed file wraps every access in try/catch and treats failure as "no stored value".
  const guarded = new Set([
    'shared/browser-storage.ts',
    'shared/admin-i18n.ts',
    'shared/home-guidance-preference.ts',
    'shared/merchant-preferences-client.ts',
    'islands/customer-translations-workflow.ts',
    'islands/MerchantHome.tsx',
    // Blocked storage must mean "never prompt", not a per-page memory store that would prompt on every visit.
    'islands/MerchantHomeContainer.tsx',
    'islands/SelectedProductEditor.tsx',
    'components/StorefrontProductTest.tsx',
  ]);
  const root = new URL('../../src/', import.meta.url);
  const offenders: string[] = [];
  for (const entry of await readdir(root, { recursive: true })) {
    const path = String(entry).replaceAll('\\', '/');
    if (!/\.(ts|tsx|mts)$/.test(path) || guarded.has(path)) continue;
    const source = await readFile(new URL(path, root), 'utf8');
    if (/\b(sessionStorage|localStorage)\b/.test(source)) offenders.push(path);
  }
  assert.deepEqual(offenders, []);
});
