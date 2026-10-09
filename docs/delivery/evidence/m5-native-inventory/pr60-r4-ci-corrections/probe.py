import concurrent.futures,json,os,subprocess,sys,tempfile,time
from pathlib import Path
repo=Path('/home/serveradmin/insignia-m5-native-inventory-worktree')
folder=Path(__file__).parent
node=subprocess.check_output(['which','node'],text=True).strip()
source=(folder/sys.argv[1]).read_text()
def control(index):
 with tempfile.TemporaryDirectory(prefix='synthetic-reader-') as parent:
  parent=Path(parent);manifest=parent/'allocation.json';manifest.write_text(json.dumps({'synthetic':'Private reader fixture, EOF withheld, no collector transport'}));manifest.chmod(0o600)
  args=[node,str(repo/'scripts/m5-native-inventory/cli.mjs'),str(manifest),str(parent/'private'),'http://127.0.0.1:1/admin/api/2026-07/graphql.json','retained-zombie']
  result=subprocess.run(['/usr/bin/python3','-B','-c',source,*args],capture_output=True,text=True,timeout=11)
  observation=json.loads(result.stdout) if result.returncode==0 else {'helperExit':result.returncode,'syntheticStderr':result.stderr}
  return {'sample':index,**observation}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 for row in pool.map(control,range(int(sys.argv[2]))):
  print(json.dumps(row),flush=True)
