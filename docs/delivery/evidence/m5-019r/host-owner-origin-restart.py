import subprocess,json,time,datetime,pathlib,hashlib
names=['insignia-rewrite-m5-019-web','insignia-rewrite-m5-019-database','insignia-app','traefik'];before=json.loads(subprocess.check_output(['docker','inspect']+names,text=True));web=before[0]
assert web['Config']['Labels']['traefik.enable']=='true' and web['State']['Health']['Status']=='healthy'
r=subprocess.run(['docker','restart','--time','10',names[0]],capture_output=True,text=True,timeout=45);assert r.returncode==0,'Restart did not settle; read-only resolution required, never retry'
for i in range(45):
 after=json.loads(subprocess.check_output(['docker','inspect']+names,text=True))
 if after[0]['State'].get('Health',{}).get('Status')=='healthy':break
 time.sleep(1)
assert after[0]['State'].get('Health',{}).get('Status')=='healthy'
assert after[0]['Id']==web['Id'] and after[0]['Image']==web['Image'] and after[0]['State']['StartedAt']!=web['State']['StartedAt']
assert after[0]['Config']['Labels']['traefik.enable']=='true'
assert 'APP_URL=https://insignia-app.optidigi.nl' in after[0]['Config']['Env']
assert all((b['Id'],b['Image'],b['State']['StartedAt'])==(a['Id'],a['Image'],a['State']['StartedAt']) for b,a in zip(before[1:],after[1:]))
p=pathlib.Path('/home/serveradmin/insignia-rewrite-m5-019');assert 'INSIGNIA_ROUTE_ENABLED=true' in (p/'.env').read_text().splitlines()
assert hashlib.sha256((p/'compose.yaml').read_bytes()).hexdigest()=='2cf6a39677b760570be3406e3d76280ec152ca40c4c01ba46e1ef2e4396faa4e'
print(json.dumps({'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'classification':'OWNER_REVISED_CANONICAL_PUBLIC_RESTART_RECOVERY_PASS','container':after[0]['Id'],'image':after[0]['Image'],'startedAtBefore':web['State']['StartedAt'],'startedAtAfter':after[0]['State']['StartedAt'],'health':'healthy','appUrl':'https://insignia-app.optidigi.nl','canonicalRoutingEnabledPersisted':True,'databaseLegacyAndTraefikUnchanged':True,'restartAttempts':1,'providerRequests':0},indent=2))
