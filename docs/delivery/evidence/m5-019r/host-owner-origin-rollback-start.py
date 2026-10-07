import subprocess,json,time,datetime
names=['insignia-rewrite-m5-019-web','insignia-rewrite-m5-019-database','insignia-app','traefik'];before=json.loads(subprocess.check_output(['docker','inspect']+names,text=True));web=before[0]
assert web['Id']=='c81927922a3b9b3b7f37e305e4f1bc6dde730c3b42cbcd5af457415b01230621' and web['State']['Status']=='exited' and web['Image']=='sha256:8aa439cb733160ce6b99165e8401cfbc60f612851aeef0d76735db92917dc3f5'
assert web['Config']['Labels']['traefik.enable']=='true' and 'APP_URL=https://insignia-app.optidigi.nl' in web['Config']['Env']
r=subprocess.run(['docker','start',names[0]],capture_output=True,text=True,timeout=45);assert r.returncode==0,'Start did not settle; no retry'
for i in range(45):
 cs=json.loads(subprocess.check_output(['docker','inspect']+names,text=True))
 if cs[0]['State'].get('Health',{}).get('Status')=='healthy':break
 time.sleep(1)
assert cs[0]['State'].get('Health',{}).get('Status')=='healthy' and cs[0]['Id']==web['Id'] and cs[0]['Image']==web['Image']
assert all((a['Id'],a['Image'],a['State']['StartedAt'])==(b['Id'],b['Image'],b['State']['StartedAt']) for a,b in zip(before[1:],cs[1:]))
print(json.dumps({'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'classification':'ROLLBACK_SAME_OWNED_WEB_c81927922a3b9b3b7f37e305e4f1bc6dde730c3b42cbcd5af457415b01230621_START_SETTLED','container':cs[0]['Id'],'image':cs[0]['Image'],'health':'healthy','canonicalAppUrl':'https://insignia-app.optidigi.nl','routeEnabled':True,'databaseLegacyAndTraefikUnchanged':True,'startAttempts':1,'legacyOrComRewriteRoutesRestored':False,'shopifyVersionCreates':0,'releases':0},indent=2))
