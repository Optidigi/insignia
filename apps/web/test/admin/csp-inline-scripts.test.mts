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

const pageRoots = [join(web, 'src/pages/admin'), join(repository, 'frontend/admin/src/pages/admin')];
const hashes = (csp: string) => new Set(csp.match(/'sha256-[A-Za-z0-9+/=]+'/g)?.map((hash) => hash.slice(1, -1)));

test('every admin page CSP allows the island runtime and the client directive bootstraps it uses, and nothing stale', async () => {
  const directives = builtClientDirectives();
  const island = sha256(await islandScript());
  const polaris = directives.get('polaris');
  const load = directives.get('load');
  assert.ok(polaris && load, 'the build registers the polaris and load client directives');
  const known = new Set([island, ...[...directives.values()].map(sha256)]);
  let checked = 0;
  for (const root of pageRoots)
    for (const page of adminPages(root)) {
      const source = readFileSync(page, 'utf8');
      const allowed = hashes(source);
      if (!allowed.size) continue;
      const name = relative(repository, page);
      checked++;
      assert.ok(allowed.has(island), `${name} allows the Astro island runtime (${island})`);
      assert.ok(allowed.has(sha256(polaris)), `${name} allows the polaris directive bootstrap`);
      if (source.includes('client:load')) assert.ok(allowed.has(sha256(load)), `${name} allows the load bootstrap`);
      for (const hash of allowed) assert.ok(known.has(hash), `${name} allows ${hash}, which no shipped script has`);
    }
  assert.ok(checked >= 20, `admin pages with a hashed script-src were found (${checked})`);
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
  const routes = adminPages(join(web, 'src/pages/admin')).map(
    (page) =>
      `/admin/${relative(join(web, 'src/pages/admin'), page)
        .replace(/\.astro$/, '')
        .replace(/(^|\/)index$/, '')
        .replace(/\[[A-Za-z]+\]/g, (segment) => sample[segment] ?? '1')}`,
  );
  const rendered = new Set<string>();
  for (const route of routes) {
    const response = await fetch(`${base}${route}?shop=fixture.myshopify.com&host=eA&embedded=1&locale=en`, {
      redirect: 'manual',
    });
    const html = await response.text();
    const allowed = hashes(response.headers.get('content-security-policy') ?? '');
    for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      const hash = sha256(match[1] ?? '');
      rendered.add(hash);
      assert.ok(allowed.has(hash), `${route} renders an inline script (${hash}) its CSP does not allow`);
    }
  }
  const directives = builtClientDirectives();
  for (const [label, script] of [
    ['island runtime', await islandScript()],
    ['polaris bootstrap', directives.get('polaris') ?? ''],
    ['load bootstrap', directives.get('load') ?? ''],
  ] as const)
    assert.ok(rendered.has(sha256(script)), `the built admin routes render the ${label} exactly as shipped`);
});
