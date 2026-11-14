import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { record, required } from './support/fixtures.mts';

test('real browser photo preparation retries the same upload UUID and PNG bytes then revokes private preview custody', async (t) => {
  const bundled = await build({
    entryPoints: [
      new URL('../../../../frontend/admin/src/islands/selected-product-media.ts', import.meta.url).pathname,
    ],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
  });
  const source = required(bundled.outputFiles[0]);
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
    'base64',
  );
  const html = `<!doctype html><script type="module">import{createSelectedProductMedia}from'/helper.js';window.run=async()=>{const original=await(await fetch('/pixel.png')).blob();const url=URL.createObjectURL(original);const id='11111111-1111-4111-8111-111111111111';const writes=[];const media=createSelectedProductMedia('gid://shopify/Product/111','a'.repeat(64),{readImage:async(path,init)=>{const response=await fetch(path,{signal:init.signal});return response.blob();},request:async(path,init)=>{const data=await init.body.arrayBuffer();const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),byte=>byte.toString(16).padStart(2,'0')).join('');writes.push({path,key:new Headers(init.headers).get('Idempotency-Key'),authority:new Headers(init.headers).get('X-Insignia-Setup-Authority'),digest});if(writes.length===1)throw Error('Lost response');return{image:{id:'upload_'+id,url:location.origin+'/api/admin/products/111/media/upload_'+id,width:1,height:1,alt:''},previewUrl:'https://private-storage.example/preview.png',expiresAt:new Date(Date.now()+60000).toISOString()};}});const prepared={id,url,width:1,height:1,alt:'Garment front'};let firstFailed=false;try{await media.upload(prepared);}catch{firstFailed=true;}const image=await media.upload(prepared);const canonical=media.canonical({id:'111',title:'Shirt',images:[image],views:[],methods:[]});media.dispose();let revoked=false;try{await fetch(image.url);}catch{revoked=true;}let lateDenied=false;try{await media.upload(prepared);}catch{lateDenied=true;}URL.revokeObjectURL(url);return{firstFailed,writes,canonical:canonical.images[0].url,revoked,lateDenied};};</script>`;
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture').pathname;
    response.setHeader(
      'Content-Type',
      path.endsWith('.js')
        ? 'text/javascript'
        : path.endsWith('.png') || path.endsWith('/preview')
          ? 'image/png'
          : 'text/html',
    );
    response.end(
      path === '/helper.js' ? source.text : path.endsWith('.png') || path.endsWith('/preview') ? pixel : html,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.waitForFunction(() => typeof Reflect.get(window, 'run') === 'function');
  const result = record(await page.evaluate(() => Reflect.get(window, 'run')()));
  assert.equal(result.firstFailed, true);
  assert.equal(result.revoked, true);
  assert.equal(result.lateDenied, true);
  assert(Array.isArray(result.writes));
  assert.equal(result.writes.length, 2);
  const first = record(result.writes[0]),
    second = record(result.writes[1]);
  assert.equal(first.key, '11111111-1111-4111-8111-111111111111');
  assert.equal(first.digest, second.digest);
  assert.equal(first.key, second.key);
  assert.equal(first.authority, 'a'.repeat(64));
  assert.equal(first.path, '/api/admin/products/111/media');
  assert.match(String(result.canonical), /\/api\/admin\/products\/111\/media\/upload_/);
  assert(!String(result.canonical).startsWith('blob:'));
});
