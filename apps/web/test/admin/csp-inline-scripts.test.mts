import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Admin pages allow inline scripts only by hash. Astro inlines its island runtime and each client directive's
// bootstrap, so an Astro or @astrojs/runtime upgrade that changes either script silently stops every island from
// hydrating. This guard derives the expected hashes from what the build actually ships (the island script from the
// resolved @astrojs/runtime, directive scripts from the built server manifest) and checks every admin CSP against them.

const web = fileURLToPath(new URL('../../', import.meta.url));
const repository = join(web, '../..');
const sha256 = (script: string) => `sha256-${createHash('sha256').update(script).digest('base64')}`;

function builtClientDirectives(): Map<string, string> {
  const source = readFileSync(join(web, 'dist/server/entry.mjs'), 'utf8');
  const key = '"clientDirectives":';
  const start = source.indexOf(key);
  assert.notEqual(start, -1, 'Run the ordinary web build first: the server manifest lists no client directives');
  let depth = 0;
  let end = start + key.length;
  for (; end < source.length; end++) {
    const character = source[end];
    if (character === '"') {
      for (end++; source[end] !== '"'; end++) if (source[end] === '\\') end++;
    } else if (character === '[') depth++;
    else if (character === ']' && --depth === 0) break;
  }
  return new Map(JSON.parse(source.slice(start + key.length, end + 1)) as [string, string][]);
}

async function islandScript(): Promise<string> {
  const astro = createRequire(createRequire(join(web, 'package.json')).resolve('astro/package.json'));
  const module = (await import(astro.resolve('@astrojs/runtime/_internal/server/astro-island.prebuilt.js'))) as {
    default: string;
  };
  return module.default;
}

function adminPages(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.astro'))
    .map((file) => join(root, file))
    .sort();
}

const webPages = join(web, 'src/pages/admin');
const pageRoots = [webPages, join(repository, 'frontend/admin/src/pages/admin')];
const redirects = new Map([
  ['billing.astro', '/admin/settings/billing'],
  ['privacy.astro', '/admin/settings/privacy'],
  ['settings/methods.astro', '/admin/methods'],
]);
const clientDirectivesUsed = (source: string) =>
  new Set((source.match(/\bclient:[\w-]+/g) ?? []).map((directive) => directive.slice('client:'.length)));

function scriptHashes(csp: string, page: string): Set<string> {
  assert.ok(!csp.includes(','), `${page} sends a single CSP policy`);
  const directives = csp.split(';').map((directive) => directive.trim().split(/\s+/));
  for (const name of ['script-src-elem', 'script-src', 'default-src']) {
    const sources = directives.find(([directive]) => directive?.toLowerCase() === name);
    if (sources)
      return new Set(
        sources.filter((source) => /^'sha256-[A-Za-z0-9+/=]+'$/.test(source)).map((source) => source.slice(1, -1)),
      );
  }
  assert.fail(`${page} has no directive governing script elements`);
}

test('every admin page CSP allows the island runtime and the client directive bootstraps it uses, and nothing stale', async () => {
  const directives = builtClientDirectives();
  const island = sha256(await islandScript());
  const known = new Set([island, ...[...directives.values()].map(sha256)]);
  let checked = 0;
  for (const root of pageRoots)
    for (const page of adminPages(root)) {
      const source = readFileSync(page, 'utf8');
      const name = relative(repository, page);
      const used = clientDirectivesUsed(source);
      if (redirects.has(relative(root, page)) && !used.size) continue;
      const csp = source.match(/[`"](default-src [^`"]+)[`"]/)?.[1];
      assert.ok(csp, `${name} declares a page CSP`);
      const allowed = scriptHashes(csp, name);
      assert.ok(allowed.has(island), `${name} allows the Astro island runtime (${island})`);
      // Keep checking the baseline polaris allowance, including on the static unavailable page.
      for (const directive of new Set(['polaris', ...used])) {
        const script = directives.get(directive);
        assert.ok(script && allowed.has(sha256(script)), `${name} allows the ${directive} bootstrap`);
      }
      for (const hash of allowed) assert.ok(known.has(hash), `${name} allows ${hash}, which no shipped script has`);
      checked++;
    }
  assert.ok(checked >= 20, `admin pages with hashed policies were found (${checked})`);
});

test('every inline script the built admin routes render is allowed by that response CSP', async (t) => {
  const child = spawn(process.execPath, [join(web, 'dist/server/entry.mjs')], {
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: '0',
      SHOPIFY_CLIENT_ID: '11111111111111111111111111111111',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill('SIGTERM'));
  let output = '';
  for (const stream of [child.stdout, child.stderr])
    stream.setEncoding('utf8').on('data', (chunk: string) => {
      output = (output + chunk).slice(-65536);
    });
  let base: string | undefined;
  for (let attempt = 0; attempt < 200 && child.exitCode === null && !base; attempt++) {
    base = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (!base) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(base, `built web server did not start: ${output}`);

  const sample: Record<string, string> = {
    '[productId]': '111',
    '[purchaseId]': '11111111-1111-4111-8111-111111111111',
    '[methodId]': '11111111-1111-4111-8111-111111111111',
  };
  const directives = builtClientDirectives();
  const island = sha256(await islandScript());
  const query = '?host=eA&shop=fixture.myshopify.com&embedded=1&locale=en';
  for (const page of adminPages(webPages)) {
    const file = relative(webPages, page);
    const route = `/admin/${file
      .replace(/\.astro$/, '')
      .replace(/(^|\/)index$/, '')
      .replace(/\[[A-Za-z]+\]/g, (segment) => sample[segment] ?? '1')}`;
    const response: Response = await fetch(`${base}${route}${query}`, { redirect: 'manual' });
    const html = await response.text();
    const redirect = redirects.get(file);
    if (redirect) {
      assert.equal(response.status, 302, route);
      assert.equal(response.headers.get('location'), redirect + query, route);
      assert.equal(html, '', route);
      continue;
    }
    // The signing page deliberately returns 404 without a signing owner. Its CSP is checked above.
    if (file === 'signing.astro') {
      assert.equal(response.status, 404, route);
      assert.ok(!/<(?:script|astro-island)\b/.test(html), `${route} renders no scripts or islands`);
      continue;
    }
    assert.equal(response.status, file === 'unavailable.astro' ? 503 : 200, route);
    const csp = response.headers.get('content-security-policy');
    assert.ok(csp, `${route} sends a CSP`);
    const allowed = scriptHashes(csp, route);
    const rendered = new Set<string>();
    for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      const hash = sha256(match[1] ?? '');
      rendered.add(hash);
      assert.ok(allowed.has(hash), `${route} renders an inline script (${hash}) its CSP does not allow`);
    }
    if (file === 'unavailable.astro') {
      assert.match(html, /\bdata-admin-unavailable-page\b/, route);
      continue;
    }
    assert.match(html, /<astro-island\b/, `${route} renders an island`);
    assert.ok(rendered.has(island), `${route} renders the island runtime`);
    const used = clientDirectivesUsed(readFileSync(page, 'utf8'));
    assert.ok(used.size, `${route} declares a client directive`);
    for (const directive of used) {
      const script = directives.get(directive);
      assert.ok(script && rendered.has(sha256(script)), `${route} renders the ${directive} bootstrap`);
    }
  }
});
