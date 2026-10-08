import json,subprocess,pathlib,hashlib,stat,datetime
p=pathlib.Path('/home/serveradmin/insignia-rewrite-m5-019')
names=['insignia-rewrite-m5-019-web','insignia-rewrite-m5-019-database','insignia-app','traefik']
cs=json.loads(subprocess.check_output(['docker','inspect']+names,text=True)); rows=[]
for c in cs:
 labels=c['Config'].get('Labels') or {}
 rows.append({'name':c['Name'],'id':c['Id'],'image':c['Image'],'startedAt':c['State']['StartedAt'],'status':c['State']['Status'],'health':c['State'].get('Health',{}).get('Status'),'hostRules':{k:v for k,v in labels.items() if k.endswith('.rule')},'traefikEnabled':labels.get('traefik.enable'),'workingDir':c['Config']['WorkingDir'],'appUrl':[v for v in c['Config']['Env'] if v.startswith('APP_URL=')],'publishedPorts':c['NetworkSettings']['Ports']})
assert rows[0]['image']=='sha256:8aa439cb733160ce6b99165e8401cfbc60f612851aeef0d76735db92917dc3f5'
files={n:{'sha256':hashlib.sha256((p/n).read_bytes()).hexdigest(),'mode':oct(stat.S_IMODE((p/n).stat().st_mode))} for n in ['compose.yaml','reviewed-web-package.tar.gz']}
assert files['compose.yaml']['sha256']=='fb6584f716f48c8be00020b7591ea180a39e94cefa82ff58233038337618272d'
assert files['reviewed-web-package.tar.gz']['sha256']=='f117be50d7bc106f1c943cdf75a8080fa63c26e0edd99b7ba0ddf3eaea697c2b'
privateModes={n:oct(stat.S_IMODE((p/n).stat().st_mode)) for n in ['.env','runtime.env','database.env']};assert set(privateModes.values())=={'0o600'}
entry=subprocess.check_output(['docker','exec',names[0],'sha256sum','dist/server/entry.mjs'],text=True).split()[0]
assert entry=='5dab1e4f21a7033582c1c2a326c97d6dcadae66ca04566a73a2aca113b4077f7'
allcs=json.loads(subprocess.check_output(['docker','inspect']+subprocess.check_output(['docker','ps','-q'],text=True).split(),text=True))
collisions=[{'name':c['Name'],'rule':v} for c in allcs for k,v in (c['Config'].get('Labels') or {}).items() if k.endswith('.rule') and 'insignia-app.optidigi.nl' in v]
fileCollision='insignia-app.optidigi.nl' in pathlib.Path('/srv/ops/infra/stacks/traefik/cloudflare-aop.dynamic.yml').read_text()
assert not collisions and not fileCollision
js="""(async()=>{let rows=[];for(let p of ['/', '/auth/login']){let r=await fetch('http://127.0.0.1:3000'+p);let t=await r.text();rows.push({path:p,status:r.status,contentType:r.headers.get('content-type'),csp:r.headers.get('content-security-policy'),h1:[...t.matchAll(/<h1[^>]*>(.*?)<\\/h1>/gs)].map(x=>x[1]),forms:[...t.matchAll(/<form[^>]*action=\"([^\"]*)\"/g)].map(x=>x[1]),bodySha256:require('crypto').createHash('sha256').update(t).digest('hex')})};console.log(JSON.stringify(rows))})().catch(()=>process.exit(1))"""
legacy=json.loads(subprocess.check_output(['docker','exec',names[2],'node','-e',js],text=True)); assert all(x['status']==200 for x in legacy)
print(json.dumps({'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceHead':'9155b4a6f9f1c7988a2dc44c4041d67c03d52bd3','containers':rows,'publicArtifactFiles':files,'privateFileModesOnly':privateModes,'entrySha256':entry,'dockerCanonicalCollisions':collisions,'fileProviderCanonicalCollision':fileCollision,'legacyInternalRootLogin':legacy,'readOnly':True},indent=2))
