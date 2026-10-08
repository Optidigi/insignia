import pathlib,subprocess,json,hashlib,base64,os,stat,time,datetime
p=pathlib.Path('/home/serveradmin/insignia-rewrite-m5-019'); old='fb6584f716f48c8be00020b7591ea180a39e94cefa82ff58233038337618272d';new='2cf6a39677b760570be3406e3d76280ec152ca40c4c01ba46e1ef2e4396faa4e'
assert hashlib.sha256((p/'compose.yaml').read_bytes()).hexdigest()==old
names=['insignia-rewrite-m5-019-web','insignia-rewrite-m5-019-database','insignia-app','traefik']
cs=json.loads(subprocess.check_output(['docker','inspect']+names,text=True)); identities={c['Name']:(c['Id'],c['Image'],c['State']['StartedAt']) for c in cs}
assert cs[0]['Image']=='sha256:8aa439cb733160ce6b99165e8401cfbc60f612851aeef0d76735db92917dc3f5'
assert all(c['State']['Status']=='running' for c in cs)
allcs=json.loads(subprocess.check_output(['docker','inspect']+subprocess.check_output(['docker','ps','-q'],text=True).split(),text=True)); assert not any('insignia-app.optidigi.nl' in v for c in allcs for k,v in (c['Config'].get('Labels') or {}).items() if k.endswith('.rule'))
assert 'insignia-app.optidigi.nl' not in pathlib.Path('/srv/ops/infra/stacks/traefik/cloudflare-aop.dynamic.yml').read_text()
for n in ['.env','runtime.env','database.env']:assert stat.S_IMODE((p/n).stat().st_mode)==0o600
backup=p/'m5-019r-owner-origin-backup';backup.mkdir(mode=0o700)
def syncdir(d):
 fd=os.open(d,os.O_DIRECTORY);os.fsync(fd);os.close(fd)
def exclusive(f,b):
 fd=os.open(f,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'wb') as s:s.write(b);s.flush();os.fsync(s.fileno())
 syncdir(f.parent)
syncdir(p)
for n in ['compose.yaml','.env']:exclusive(backup/n,(p/n).read_bytes())
newbytes=base64.b64decode('bmFtZTogaW5zaWduaWEtcmV3cml0ZS1tNS0wMTkKCnNlcnZpY2VzOgogIHdlYjoKICAgIGltYWdlOiAke0lOU0lHTklBX1dFQl9JTUFHRTo/U2V0IHRoZSBxdWFsaWZpZWQgaW1tdXRhYmxlIHdlYiBpbWFnZX0KICAgIHB1bGxfcG9saWN5OiBuZXZlcgogICAgY29udGFpbmVyX25hbWU6IGluc2lnbmlhLXJld3JpdGUtbTUtMDE5LXdlYgogICAgcmVzdGFydDogdW5sZXNzLXN0b3BwZWQKICAgIHJlYWRfb25seTogdHJ1ZQogICAgdG1wZnM6CiAgICAgIC0gL3RtcDpzaXplPTY0bSxtb2RlPTE3NzcKICAgIGNhcF9kcm9wOiBbQUxMXQogICAgc2VjdXJpdHlfb3B0OiBbbm8tbmV3LXByaXZpbGVnZXM6dHJ1ZV0KICAgIGVudl9maWxlOiBydW50aW1lLmVudgogICAgZW52aXJvbm1lbnQ6CiAgICAgIE5PREVfRU5WOiBwcm9kdWN0aW9uCiAgICAgIEhPU1Q6IDAuMC4wLjAKICAgICAgUE9SVDogIjMwMDAiCiAgICAgIEFQUF9VUkw6IGh0dHBzOi8vaW5zaWduaWEtYXBwLm9wdGlkaWdpLm5sCiAgICAgIFNIT1BJRllfQ0xJRU5UX0lEOiAxNDQzY2Y2ZDAzZDM5ZWRhZTdjMTAxYTk0M2M1YzY4NAogICAgICBJTlNJR05JQV9TSE9QSUZZX0FQUF9JRDogIjQyOTAyODkzMzYzMyIKICAgIG5ldHdvcmtzOiBbcHJveHksIHByaXZhdGVdCiAgICBkZXBlbmRzX29uOgogICAgICBkYXRhYmFzZToKICAgICAgICBjb25kaXRpb246IHNlcnZpY2VfaGVhbHRoeQogICAgaGVhbHRoY2hlY2s6CiAgICAgIHRlc3Q6IFtDTUQsIG5vZGUsIC1lLCAiZmV0Y2goJ2h0dHA6Ly8xMjcuMC4wLjE6MzAwMC9saXZlJykudGhlbihyPT5wcm9jZXNzLmV4aXQoci5zdGF0dXM9PT0yMDA/MDoxKSkuY2F0Y2goKCk9PnByb2Nlc3MuZXhpdCgxKSkiXQogICAgICBpbnRlcnZhbDogMTVzCiAgICAgIHRpbWVvdXQ6IDVzCiAgICAgIHJldHJpZXM6IDMKICAgICAgc3RhcnRfcGVyaW9kOiAxNXMKICAgIGxhYmVsczoKICAgICAgdHJhZWZpay5lbmFibGU6ICIke0lOU0lHTklBX1JPVVRFX0VOQUJMRUQ6LWZhbHNlfSIKICAgICAgdHJhZWZpay5kb2NrZXIubmV0d29yazogcHJveHkKICAgICAgdHJhZWZpay5odHRwLnJvdXRlcnMuaW5zaWduaWEtY2Fub25pY2FsLW01LTAxOXIuZW50cnlwb2ludHM6IHdlYnNlY3VyZQogICAgICB0cmFlZmlrLmh0dHAucm91dGVycy5pbnNpZ25pYS1jYW5vbmljYWwtbTUtMDE5ci5ydWxlOiBIb3N0KGBpbnNpZ25pYS1hcHAub3B0aWRpZ2kubmxgKQogICAgICB0cmFlZmlrLmh0dHAucm91dGVycy5pbnNpZ25pYS1jYW5vbmljYWwtbTUtMDE5ci5wcmlvcml0eTogIjEwMDAiCiAgICAgIHRyYWVmaWsuaHR0cC5yb3V0ZXJzLmluc2lnbmlhLWNhbm9uaWNhbC1tNS0wMTlyLnRscy5jZXJ0cmVzb2x2ZXI6IGxldHNlbmNyeXB0CiAgICAgIHRyYWVmaWsuaHR0cC5yb3V0ZXJzLmluc2lnbmlhLWNhbm9uaWNhbC1tNS0wMTlyLnNlcnZpY2U6IGluc2lnbmlhLXJld3JpdGUtbTUtMDE5CiAgICAgIHRyYWVmaWsuaHR0cC5zZXJ2aWNlcy5pbnNpZ25pYS1yZXdyaXRlLW01LTAxOS5sb2FkYmFsYW5jZXIuc2VydmVyLnBvcnQ6ICIzMDAwIgogICAgICB0cmFlZmlrLmh0dHAuc2VydmljZXMuaW5zaWduaWEtcmV3cml0ZS1tNS0wMTkubG9hZGJhbGFuY2VyLmhlYWx0aGNoZWNrLnBhdGg6IC9saXZlCiAgICAgIHRyYWVmaWsuaHR0cC5zZXJ2aWNlcy5pbnNpZ25pYS1yZXdyaXRlLW01LTAxOS5sb2FkYmFsYW5jZXIuaGVhbHRoY2hlY2suaW50ZXJ2YWw6IDE1cwogICAgICB0cmFlZmlrLmh0dHAuc2VydmljZXMuaW5zaWduaWEtcmV3cml0ZS1tNS0wMTkubG9hZGJhbGFuY2VyLmhlYWx0aGNoZWNrLnRpbWVvdXQ6IDVzCgogIGRhdGFiYXNlOgogICAgaW1hZ2U6IHBvc3RncmVzOjE4LjYtYm9va3dvcm1Ac2hhMjU2Ojk1NTFkZDViZjM1NjQwOWEyMWIzMTI0OGY0OWIzM2JiYTliYjE4NzczNjVmM2E3ZTkzM2FlY2Q5YWYzY2Y1MmQKICAgIGNvbnRhaW5lcl9uYW1lOiBpbnNpZ25pYS1yZXdyaXRlLW01LTAxOS1kYXRhYmFzZQogICAgcmVzdGFydDogdW5sZXNzLXN0b3BwZWQKICAgIGVudl9maWxlOiBkYXRhYmFzZS5lbnYKICAgIG5ldHdvcmtzOiBbcHJpdmF0ZV0KICAgIHZvbHVtZXM6CiAgICAgIC0gZGF0YWJhc2U6L3Zhci9saWIvcG9zdGdyZXNxbAogICAgaGVhbHRoY2hlY2s6CiAgICAgIHRlc3Q6IFtDTUQtU0hFTEwsICJwZ19pc3JlYWR5IC1VIGluc2lnbmlhX3Jld3JpdGUgLWQgaW5zaWduaWFfcmV3cml0ZSJdCiAgICAgIGludGVydmFsOiA1cwogICAgICB0aW1lb3V0OiAzcwogICAgICByZXRyaWVzOiAxMgoKbmV0d29ya3M6CiAgcHJveHk6CiAgICBleHRlcm5hbDogdHJ1ZQogICAgbmFtZTogcHJveHkKICBwcml2YXRlOgogICAgaW50ZXJuYWw6IHRydWUKCnZvbHVtZXM6CiAgZGF0YWJhc2U6Cg==',validate=True);assert hashlib.sha256(newbytes).hexdigest()==new
lines=(p/'.env').read_text().splitlines(); route=[i for i,x in enumerate(lines) if x.startswith('INSIGNIA_ROUTE_ENABLED=')]; assert len(route)==1
lines[route[0]]='INSIGNIA_ROUTE_ENABLED=false'
assert len([x for x in lines if x.startswith('INSIGNIA_WEB_IMAGE=')])==1
for name,data in [('compose.yaml',newbytes),('.env',('\n'.join(lines)+'\n').encode())]:
 t=p/(name+'.m5-019r-tmp');exclusive(t,data);os.replace(t,p/name);syncdir(p)
check=subprocess.run(['docker','compose','--project-directory',str(p),'-f',str(p/'compose.yaml'),'config','--quiet'],capture_output=True,text=True);assert check.returncode==0,'Compose validation failed; no container update performed'
up=subprocess.run(['docker','compose','--project-directory',str(p),'-f',str(p/'compose.yaml'),'up','-d','--no-deps','--no-build','--pull','never','web'],capture_output=True,text=True,timeout=120)
assert up.returncode==0,'Container update did not settle; no retry'
for i in range(45):
 c=json.loads(subprocess.check_output(['docker','inspect',names[0]],text=True))[0]
 if c['State'].get('Health',{}).get('Status')=='healthy':break
 time.sleep(1)
assert c['State'].get('Health',{}).get('Status')=='healthy','Health did not settle'
assert c['Image']==cs[0]['Image']; labels=c['Config']['Labels'];assert labels['traefik.enable']=='false';assert labels['traefik.http.routers.insignia-canonical-m5-019r.rule']=='Host(`insignia-app.optidigi.nl`)'
assert not any('insignia.optidigi.nl' in v for k,v in labels.items() if k.endswith('.rule'))
assert [v for v in c['Config']['Env'] if v.startswith('APP_URL=')]==['APP_URL=https://insignia-app.optidigi.nl']
now=json.loads(subprocess.check_output(['docker','inspect']+names[1:],text=True));assert all(identities[x['Name']]==(x['Id'],x['Image'],x['State']['StartedAt']) for x in now)
entry=subprocess.check_output(['docker','exec',names[0],'sha256sum','dist/server/entry.mjs'],text=True).split()[0];assert entry=='5dab1e4f21a7033582c1c2a326c97d6dcadae66ca04566a73a2aca113b4077f7'
print(json.dumps({'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'classification':'OWNER_REVISED_CANONICAL_PRIVATE_STAGE_PASS_PUBLIC_ROUTING_PENDING','composeSha256':new,'image':c['Image'],'entrySha256':entry,'webContainer':c['Id'],'health':'healthy','appUrl':'https://insignia-app.optidigi.nl','traefikExposed':False,'canonicalRule':labels['traefik.http.routers.insignia-canonical-m5-019r.rule'],'rewriteNlRouterRemoved':True,'databaseLegacyAndTraefikIdentitiesUnchanged':True,'privateBackupMode':oct(stat.S_IMODE(backup.stat().st_mode)),'buildAttempts':0,'databaseMigrations':0,'providerRequests':0},indent=2))
