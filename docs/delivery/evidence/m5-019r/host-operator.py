import pathlib,subprocess,json,datetime,os,sys
P=pathlib.Path('/home/serveradmin/insignia-m5-019r-handoff');R=P/'host-register.json'
SSH=['ssh','-i',str(P/'access/id_ed25519'),'-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(P/'access/prod-known-hosts'),'-o','BatchMode=yes','-o','ConnectTimeout=15','serveradmin@65.109.22.104','python3','-']
def save(v):
 t=R.with_suffix('.tmp');fd=os.open(t,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
 with os.fdopen(fd,'w') as f:json.dump(v,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 os.replace(t,R);fd=os.open(P,os.O_DIRECTORY);os.fsync(fd);os.close(fd)
def execute(kind,script,receipt,mutation=False):
 if R.exists(): r=json.loads(R.read_text())
 else:r={'slice':'M5-019R','closed':False,'sourceHead':'9b0810dd8383ae578a3c960b327786694f1b222e','events':[],'hostMutationAttempts':0,'appVersionCreates':0,'releases':0}
 assert not r['closed'] and not any(x['outcome']=='RESERVED' for x in r['events'])
 assert not any(x['kind']==kind for x in r['events']), 'one-attempt kind already reserved'
 event={'kind':kind,'mutation':mutation,'reservedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'outcome':'RESERVED'};r['events'].append(event)
 if mutation:r['hostMutationAttempts']+=1
 save(r)
 s=subprocess.run(SSH,input=script,text=True,capture_output=True,timeout=180)
 log=P/(receipt+'.private.log'); log.write_text(s.stderr);log.chmod(0o600)
 event['exitCode']=s.returncode;event['settledAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
 if s.returncode:
  event['outcome']='STOPPED_ERROR_REQUIRES_READ_ONLY_RESOLUTION';save(r);raise SystemExit('Remote operation failed; inspect private sanitized diagnostics, no retry')
 data=json.loads(s.stdout);(P/receipt).write_text(json.dumps(data,indent=2)+'\n');event['outcome']='SETTLED';event['receipt']=receipt;save(r);print(json.dumps(data,indent=2))
if __name__=='__main__':execute(sys.argv[1],(P/sys.argv[2]).read_text(),sys.argv[3],len(sys.argv)>4 and sys.argv[4]=='mutation')
