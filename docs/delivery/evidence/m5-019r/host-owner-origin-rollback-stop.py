import subprocess,json,datetime
names=['insignia-rewrite-m5-019-web','insignia-rewrite-m5-019-database','insignia-app','traefik'];cs=json.loads(subprocess.check_output(['docker','inspect']+names,text=True));c=cs[0]
assert c['State']['Health']['Status']=='healthy' and c['Config']['Labels']['traefik.enable']=='true'
assert c['Image']=='sha256:8aa439cb733160ce6b99165e8401cfbc60f612851aeef0d76735db92917dc3f5' and 'APP_URL=https://insignia-app.optidigi.nl' in c['Config']['Env']
result=subprocess.run(['docker','stop','--time','10',names[0]],capture_output=True,text=True,timeout=45);assert result.returncode==0,'Stop did not settle; no blind restart/retry'
now=json.loads(subprocess.check_output(['docker','inspect']+names,text=True));assert now[0]['State']['Status']=='exited';assert now[0]['Id']==c['Id']
assert all((a['Id'],a['Image'],a['State']['StartedAt'])==(b['Id'],b['Image'],b['State']['StartedAt']) for a,b in zip(cs[1:],now[1:]))
print(json.dumps({'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'classification':'ROLLBACK_WEB_STOP_SETTLED_PUBLIC_READ_REQUIRED','container':c['Id'],'image':c['Image'],'status':'exited','databaseLegacyAndTraefikUnchanged':True,'legacyOrComRewriteRoutesRestored':False,'shopifyVersionCreates':0,'releases':0},indent=2))
