/** Runs the actual pure observation qualifier, never the operator main/DB/provider path. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const source=readFileSync(new URL('./release-append.mjs',import.meta.url),'utf8');
const prefix=source.slice(0,source.indexOf('let recordId = null;'));
assert.ok(prefix.includes('export function qualifyReleaseObservations'));
const controls=`
const now=Date.parse('2026-10-08T12:00:00.000Z');
const active={observedAt:new Date(now-100).toISOString(),versions:[]};
const functions={shopId:'synthetic-local-shop',installationGeneration:'1',appClientId:'synthetic-client',observedAt:new Date(now-1000).toISOString(),
 transform:{functionId:'synthetic-transform',handle:'synthetic',apiType:'cart_transform',apiVersion:'2026-07',inputQuerySha256:'a'.repeat(64)},
 validation:{functionId:'synthetic-validation',handle:'synthetic',apiType:'cart_checkout_validation',apiVersion:'2026-07',inputQuerySha256:'b'.repeat(64)}};
const original=JSON.stringify({active,functions});
const result=qualifyReleaseObservations(active,functions,now);
assert.equal(result.expiresAt,new Date(now-1000+30000).toISOString());
assert.equal(result.functionObservedAt,functions.observedAt);
assert.equal(result.observedAt,active.observedAt);
assert.equal(JSON.stringify({active,functions}),original);
const changed=qualifyReleaseObservations(active,{...functions,observedAt:new Date(now-999).toISOString()},now);
assert.equal(changed.activeObservationEvidenceSha256,result.activeObservationEvidenceSha256);
assert.notEqual(changed.functionObservationEvidenceSha256,result.functionObservationEvidenceSha256);
assert.notEqual(changed.proof,result.proof);
const olderActive=qualifyReleaseObservations({...active,observedAt:new Date(now-2000).toISOString()},functions,now);
assert.equal(olderActive.expiresAt,new Date(now-2000+30000).toISOString());
for(const observedAt of [new Date(now-30000).toISOString(),new Date(now+1).toISOString(),'invalid',undefined])
 assert.throws(()=>qualifyReleaseObservations(active,{...functions,observedAt},now));
const equality=qualifyReleaseObservations({...active,observedAt:new Date(now).toISOString()},{...functions,observedAt:new Date(now).toISOString()},now);
assert.equal(equality.expiresAt,new Date(now+30000).toISOString());
console.log('PASS actual qualifier: original timestamps/bytes preserved, both receipt hashes bound, earliest expiry, exact30s/future/invalid/missing rejection and equality; DB/provider calls0');
`;
const output=execFileSync(process.execPath,['--input-type=module','-e',prefix+controls],{
 cwd:fileURLToPath(new URL('../../../../../apps/web',import.meta.url)),
 env:{PATH:process.env.PATH,NODE_ENV:'test'},encoding:'utf8'});
assert.match(output,/^PASS actual qualifier:/);process.stdout.write(output);
