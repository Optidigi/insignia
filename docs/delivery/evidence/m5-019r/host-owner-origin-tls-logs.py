import subprocess,json,datetime
r=subprocess.run(['docker','logs','--since','2026-10-07T23:35:00Z','traefik'],capture_output=True,text=True)
lines=[x for x in (r.stdout+r.stderr).splitlines() if 'insignia-app.optidigi.nl' in x and any(y in x.lower() for y in ['certificate','acme','authorization','error'])]
print(json.dumps({'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'readOnlyTLSLogs':lines,'secretOrCertificatePrivateKeyRead':False},indent=2))
