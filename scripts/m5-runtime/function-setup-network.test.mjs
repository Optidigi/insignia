import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('actual pinned SDK online exchange uses the admitted transport and no ambient fallback', () => {
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import {createHmac} from 'node:crypto';
    import {createServer} from 'node:http';
    import {createAdminOnlineIdentity} from ${JSON.stringify(new URL('../../packages/shopify/dist/index.js', import.meta.url).href)};
    import {installFunctionSetupNetwork} from ${JSON.stringify(new URL('./function-setup-network.mjs', import.meta.url).href)};
    const originalFetch = globalThis.fetch, secret='SYNTHETIC_SDK_SECRET', key='1443cf6d03d39edae7c101a943c5c684';
    const now=Math.floor(Date.now()/1000), encoded=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
    const signing=encoded({alg:'HS256',typ:'JWT'})+'.'+encoded({aud:key,sub:'23',sid:'synthetic-session',
      dest:'https://insignia-rewrite-dev.myshopify.com',iss:'https://insignia-rewrite-dev.myshopify.com/admin',iat:now,nbf:now-1,exp:now+60});
    const idToken=signing+'.'+createHmac('sha256',secret).update(signing).digest('base64url');
    let requests=0;
    const server=createServer((req,res)=>{requests++;res.setHeader('content-type','application/json');
      res.end(JSON.stringify({access_token:'SYNTHETIC_ONLINE_TOKEN',scope:'write_products,write_cart_transforms,write_validations',
        expires_in:3600,associated_user_scope:'write_products,write_cart_transforms,write_validations',associated_user:{id:23}}));});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const network=installFunctionSetupNetwork({journal:{reserve(){return true;},dispatch(op){assert.equal(op,'AUTH_ONLINE');},settle(){}},
      auth:{idToken,clientSecret:secret},deadline:Date.now()+30000,
      documents:{installation:'query Install{}',ownership:'query Owned{}',transform:'mutation Transform{}',validation:'mutation Validation{}'},
      nativeTransport:(_url,options)=>originalFetch('http://127.0.0.1:'+server.address().port,options)});
    try {
      const identity=createAdminOnlineIdentity({apiKey:key,apiSecret:secret,hostName:'insignia-app.optidigi.nl',fetchImpl:network.fetch});
      const staff=await identity.verify(idToken), grant=await identity.exchangeOnline(idToken,staff);
      assert.equal(grant.staffId,'23'); assert.ok(grant.userScopes.includes('write_cart_transforms'));
      assert.equal(requests,1); network.assertNoEscape();
      const omitted=createAdminOnlineIdentity({apiKey:key,apiSecret:secret,hostName:'insignia-app.optidigi.nl'});
      await assert.rejects(omitted.exchangeOnline(idToken,staff), {stage:'ONLINE_EXCHANGE_FAILED'});
      assert.equal(requests,1);
    } finally {await new Promise(resolve=>server.close(resolve));}
  `,
    ],
    { encoding: 'utf8', timeout: 15000 },
  );
  assert.equal(child.status, 0, child.stderr);
});

test('fresh process denies ambient network and unreserved writes; admitted reads use only loopback', () => {
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import {createServer, request} from 'node:http';
    import {installFunctionSetupNetwork} from ${JSON.stringify(new URL('./function-setup-network.mjs', import.meta.url).href)};
    const originalFetch = globalThis.fetch;
    let outbound = 0;
    const server = createServer((req,res)=>{outbound++; res.setHeader('content-type','application/json');res.end('{}');});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const journal = { reserve(){return true;}, dispatch(operation){assert.equal(operation,'READ_PRESTATE');} };
    const guarded = installFunctionSetupNetwork({journal, deadline:Date.now()+30000,
      documents:{installation:'query Install{}',ownership:'query Owned{}',transform:'mutation Transform{}',validation:'mutation Validation{}'},
      auth:{idToken:'SYNTHETIC_ID_TOKEN',clientSecret:'SYNTHETIC_SECRET'},
      nativeTransport: (_url,options)=>originalFetch('http://127.0.0.1:'+server.address().port,options)});
    try {
      await assert.rejects(guarded.fetch('https://insignia-rewrite-dev.myshopify.com/admin/api/2026-07/graphql.json',
        {method:'POST',body:JSON.stringify({query:'mutation Transform{}',variables:{}})}));
      guarded.bindToken('SYNTHETIC_ONLINE_TOKEN');
      const response = await guarded.fetch('https://insignia-rewrite-dev.myshopify.com/admin/api/2026-07/graphql.json',
        {method:'POST',headers:{'X-Shopify-Access-Token':'SYNTHETIC_ONLINE_TOKEN'},body:JSON.stringify({query:'query Owned{}',variables:{}})});
      assert.equal(response.status,200); assert.equal(outbound,1);
      await assert.rejects(globalThis.fetch('http://127.0.0.1:'+server.address().port),/network_escape_denied/);
      assert.throws(()=>request('http://127.0.0.1:'+server.address().port),/network_escape_denied/);
      await assert.rejects(guarded.fetch('https://insignia-rewrite-dev.myshopify.com/admin/api/2026-07/graphql.json',
        {method:'POST',body:JSON.stringify({query:'mutation Transform{}',variables:{}})}),/network_escape_denied/);
      assert.equal(outbound,1);
    } finally {await new Promise(resolve=>server.close(resolve));}
  `,
    ],
    { encoding: 'utf8', timeout: 15000 },
  );
  assert.equal(child.status, 0, child.stderr);
});
