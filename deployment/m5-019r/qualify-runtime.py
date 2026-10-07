"""Exercise the actual packaged standalone build with synthetic credentials and local HTTP only."""
from pathlib import Path
import subprocess,os,json,socket,time,urllib.request,urllib.error,sys,re,hashlib
runtime=Path(sys.argv[1]).resolve();out=Path(sys.argv[2]).resolve();out.mkdir(parents=True,exist_ok=True);stem='qualified-standalone'
s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close()
env={**{k:os.environ[k] for k in ['PATH','LANG','LC_ALL','TZ'] if k in os.environ},'NODE_ENV':'production','HOST':'127.0.0.1','PORT':str(port),'SHOPIFY_CLIENT_ID':'1443cf6d03d39edae7c101a943c5c684','SHOPIFY_CLIENT_SECRET':'offline-synthetic-not-provider-secret','APP_URL':'https://insignia-app.optidigi.nl','INSIGNIA_SHOPIFY_APP_ID':'429028933633','DATABASE_URL':'postgres://offline:offline@127.0.0.1:1/offline'}
env.pop('INSIGNIA_M5_002_DIAGNOSTIC',None);env.pop('SSH_AUTH_SOCK',None)
(out/'no-external-fetch.mjs').write_text("let attempts=0;globalThis.fetch=async()=>{attempts++;throw new Error('offline_network_escape_denied')};process.on('SIGTERM',()=>{console.log(JSON.stringify({offlineFetchAttempts:attempts}));process.exit(0)});\n");log=(out/(stem+'.log')).open('w');p=subprocess.Popen(['node','--import',str(out/'no-external-fetch.mjs'),'dist/server/entry.mjs'],cwd=runtime,env=env,stdout=log,stderr=subprocess.STDOUT)
result={'productionArtifact':'approved byte-identical standalone build with frozen production dependencies','credentials':'synthetic offline only','fetchGuard':'globalThis.fetch fail-closed in test process only','port':port,'routes':[]}
try:
 for attempt in range(40):
  if p.poll() is not None:raise RuntimeError('runtime_exited')
  try:
   with urllib.request.urlopen(f'http://127.0.0.1:{port}/live',timeout=1) as r:
    if r.status==200:break
  except (OSError,urllib.error.URLError):time.sleep(.1)
 else:raise RuntimeError('startup_timeout')
 def get(path):
  try:r=urllib.request.urlopen(f'http://127.0.0.1:{port}'+path,timeout=5)
  except urllib.error.HTTPError as err:r=err
  with r:
   body=r.read();result['routes'].append({'path':path,'status':r.status,'contentType':r.headers.get('content-type'),'cacheControl':r.headers.get('cache-control'),'csp':r.headers.get('content-security-policy'),'correctPublicClientPresent':b'1443cf6d03d39edae7c101a943c5c684' in body,'bytes':len(body)});return body
 get('/live');html=get('/admin/products');get('/api/admin/products');get('/api/admin/products/1/config')
 assets=re.findall(r'[\"\'](/_astro/[^\"\']+)[\"\']',html.decode())
 assert assets,'missing_production_assets'
 get_asset = get(assets[0])
 assert [r['status'] for r in result['routes']] == [200,200,401,401,200], 'unexpected_http_status'
 assert result['routes'][1]['correctPublicClientPresent'], 'wrong_public_client'
 assert 'private' in result['routes'][1]['cacheControl'] and 'no-store' in result['routes'][1]['cacheControl'], 'unsafe_bootstrap_cache'
 assert 'https://*.myshopify.com' in result['routes'][1]['csp'] and 'https://admin.shopify.com' in result['routes'][1]['csp'], 'wrong_frame_ancestors'
 for row in result['routes'][2:4]:
  assert 'private' in row['cacheControl'] and 'no-store' in row['cacheControl'], 'unsafe_api_cache'
 assert 'immutable' in result['routes'][4]['cacheControl'] and get_asset, 'missing_immutable_asset'
 result['exit']='PASS'
except Exception as err:result['exit']='FAIL';result['error']=str(err)
finally:
 p.terminate()
 try:p.wait(timeout=5)
 except subprocess.TimeoutExpired:p.kill();p.wait()
 log.close();result['processStopped']=True
 log_text=(out/(stem+'.log')).read_text()
 result['guardDenialInLog']='offline_network_escape_denied' in log_text
 counts=re.findall(r'"offlineFetchAttempts":(\d+)',log_text)
 result['offlineFetchAttempts']=int(counts[-1]) if counts else None
 if result['guardDenialInLog'] or result['offlineFetchAttempts'] != 0:result['exit']='FAIL';result['error']='external_fetch_attempt_or_missing_guard_receipt'
 result['webEntrySha256']=hashlib.sha256((runtime/'dist/server/entry.mjs').read_bytes()).hexdigest()
(out/(stem+'.json')).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));sys.exit(0 if result['exit']=='PASS' else 1)
