import pathlib,subprocess,json,hashlib,os,datetime,time,stat
p=pathlib.Path('/home/serveradmin/insignia-rewrite-m5-019');expected='2cf6a39677b760570be3406e3d76280ec152ca40c4c01ba46e1ef2e4396faa4e';assert hashlib.sha256((p/'compose.yaml').read_bytes()).hexdigest()==expected
names=['insignia-rewrite-m5-019-web','insignia-rewrite-m5-019-database','insignia-app','traefik'];before=json.loads(subprocess.check_output(['docker','inspect']+names,text=True));web=before[0]
assert web['Image']=='sha256:8aa439cb733160ce6b99165e8401cfbc60f612851aeef0d76735db92917dc3f5' and web['State']['Health']['Status']=='healthy'
assert web['Config']['Labels']['traefik.enable']=='false' and 'APP_URL=https://insignia-app.optidigi.nl' in web['Config']['Env']
allcs=json.loads(subprocess.check_output(['docker','inspect']+subprocess.check_output(['docker','ps','-q'],text=True).split(),text=True));assert not any('insignia-app.optidigi.nl' in v for c in allcs if c['Name']!=web['Name'] for k,v in (c['Config'].get('Labels') or {}).items() if k.endswith('.rule'))
assert 'insignia-app.optidigi.nl' not in pathlib.Path('/srv/ops/infra/stacks/traefik/cloudflare-aop.dynamic.yml').read_text()
assert stat.S_IMODE((p/'.env').stat().st_mode)==0o600
b=(p/'.env').read_bytes();backup=p/'.env.owner-origin-pre-exposure';fd=os.open(backup,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
lines=b.decode().splitlines();indices=[i for i,x in enumerate(lines) if x.startswith('INSIGNIA_ROUTE_ENABLED=')];assert len(indices)==1 and lines[indices[0]]=='INSIGNIA_ROUTE_ENABLED=false';lines[indices[0]]='INSIGNIA_ROUTE_ENABLED=true'
t=p/'.env.owner-origin-exposure.tmp';fd=os.open(t,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:f.write('\n'.join(lines)+'\n');f.flush();os.fsync(f.fileno())
os.replace(t,p/'.env');fd=os.open(p,os.O_DIRECTORY);os.fsync(fd);os.close(fd)
check=subprocess.run(['docker','compose','--project-directory',str(p),'-f',str(p/'compose.yaml'),'config','--quiet'],capture_output=True,text=True);assert check.returncode==0
r=subprocess.run(['docker','compose','--project-directory',str(p),'-f',str(p/'compose.yaml'),'up','-d','--no-deps','--no-build','--pull','never','web'],capture_output=True,text=True,timeout=120);assert r.returncode==0,'Exposure update did not settle; no retry'
for i in range(45):
 cs=json.loads(subprocess.check_output(['docker','inspect']+names,text=True))
 if cs[0]['State'].get('Health',{}).get('Status')=='healthy':break
 time.sleep(1)
c=cs[0];assert c['State'].get('Health',{}).get('Status')=='healthy' and c['Image']==web['Image']
labels=c['Config']['Labels'];assert labels['traefik.enable']=='true' and labels['traefik.http.routers.insignia-canonical-m5-019r.rule']=='Host(`insignia-app.optidigi.nl`)'
assert not any('insignia.optidigi.com' in v or 'insignia.optidigi.nl' in v for k,v in labels.items() if k.endswith('.rule'))
assert all((a['Id'],a['Image'],a['State']['StartedAt'])==(b['Id'],b['Image'],b['State']['StartedAt']) for a,b in zip(before[1:],cs[1:]))
print(json.dumps({'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'classification':'OWNER_REVISED_CANONICAL_TRAEFIK_EXPOSURE_SETTLED_PUBLIC_QUALIFICATION_REQUIRED','canonicalOrigin':'https://insignia-app.optidigi.nl','runtimeAppUrl':'https://insignia-app.optidigi.nl','applicationUrl':'https://insignia-app.optidigi.nl/admin/products','composeSha256':expected,'webContainer':c['Id'],'image':c['Image'],'health':'healthy','routeEnabled':True,'rule':labels['traefik.http.routers.insignia-canonical-m5-019r.rule'],'databaseLegacyAndTraefikUnchanged':True,'supersededRewriteRoutesRemoved':True,'tlsResolver':'existing_letsencrypt_HTTP_challenge_public_qualification_pending','shopifyVersionCreates':0,'releases':0,'buildAttempts':0},indent=2))
