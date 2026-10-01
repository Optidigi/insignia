import { openSync, closeSync, readFileSync, writeFileSync, fsyncSync } from 'node:fs';
import { basename } from 'node:path';
const path = '/home/serveradmin/insignia-m5-002r-handoff/correction-register.json';
export function reserve(kind, purpose) {
  const state = JSON.parse(readFileSync(path, 'utf8'));
  if (state.appId !== '429028933633' || state.clientId !== '1443cf6d03d39edae7c101a943c5c684' || state.shop !== 'insignia-rewrite-dev.myshopify.com') throw Error('Correction target mismatch');
  for (const [name, limit] of Object.entries({adminRead:20,adminAuth:6,partnerRead:0})) {
    if (state.limits[name] !== limit || !Number.isInteger(state.counts[name]) || state.counts[name] < 0 || state.counts[name] > limit || state.events.filter(e=>e.kind===name).length !== state.counts[name]) throw Error('Correction history ambiguous');
  }
  if (!Object.hasOwn(state.counts,kind) || state.counts[kind] >= state.limits[kind]) throw Error('Correction ceiling reached');
  state.counts[kind]++;
  state.events.push({kind,purpose,at:new Date().toISOString()});
  const fd=openSync(path,'w',0o600);
  try {writeFileSync(fd,JSON.stringify(state,null,2)+'\n');fsyncSync(fd);} finally {closeSync(fd);}
}
export function guard(fetchImpl) {
  return async (input,init)=>{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    if(url.origin!=='https://insignia-rewrite-dev.myshopify.com'||url.username||url.password||url.search||url.hash||init?.method!=='POST')throw Error('Correction external target denied');
    const body=JSON.parse(String(init.body??''));
    if(url.pathname==='/admin/api/2026-07/graphql.json') {
      if(typeof body.query!=='string'||!/^\s*query\b/.test(body.query)||/\bmutation\b/.test(body.query))throw Error('Correction read-only operation denied');
      reserve('adminRead','diagnostic GraphQL attempt: '+(/^\s*query\s+(\w+)/.exec(body.query)?.[1]??'anonymous read'));
    } else if(url.pathname==='/admin/oauth/access_token') {
      if(body.client_id!=='1443cf6d03d39edae7c101a943c5c684'||body.grant_type!=='urn:ietf:params:oauth:grant-type:token-exchange'||body.requested_token_type!=='urn:shopify:params:oauth:token-type:online-access-token')throw Error('Correction auth operation denied');
      reserve('adminAuth','diagnostic online token-exchange attempt');
    } else throw Error('Correction operation denied');
    return fetchImpl(input,{...init,redirect:'error'});
  };
}
// Only the reviewed diagnostic server receives this stricter outer transport.
// CLI plumbing is separately conservatively reserved by the sole operator.
if(basename(process.argv[1]??'')==='preview-server.mjs') globalThis.fetch=guard(globalThis.fetch);
