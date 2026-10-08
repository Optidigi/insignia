"""Actual archive/dispatch filesystem boundary, simulated Docker only; no live access."""
import importlib.util,json,sys,tempfile
from pathlib import Path
source=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).with_name('host-operator.py')
spec=importlib.util.spec_from_file_location('op',source);op=importlib.util.module_from_spec(spec);spec.loader.exec_module(op)
n=Path('/home/serveradmin/insignia-m5-023-handoff')
with tempfile.TemporaryDirectory() as d:
 op.ROOT=Path(d);op.APP=op.ROOT/'app';op.APP.mkdir()
 original=('INSIGNIA_WEB_IMAGE='+op.OLD_IMAGE+'\n').encode();(op.APP/'.env').write_bytes(original)
 (op.ROOT/'expected-inputs.json').write_bytes((n/'expected-inputs.json').read_bytes())
 for name in ['provision-settled.json']:(op.ROOT/name).write_text('{}')
 (op.ROOT/'lifecycle-settled.json').write_text(json.dumps({'classification':'PASS_UNINSTALL_PROCESSOR','candidateConfigSha256':'synthetic-fixed'}))
 for name in ['reviewed-web-package.tar.gz','package-inventory.json','build-context']:(op.ROOT/name).symlink_to(n/name)
 op.prestate=lambda:[{'Image':op.OLD_IMAGE}]
 lost={'value':False};calls=[]
 op.qualify_lifecycle=lambda:{'classification':'BLOCKED_UNINSTALL_PROCESSOR_READINESS' if lost['value'] else 'PASS_UNINSTALL_PROCESSOR','candidateConfigSha256':'synthetic-fixed'}
 def config(image):
  return (['docker','compose','--env-file','runtime.env','-f','compose.yaml'],{}, {}, {},'synthetic-fixed',{'services':{'web':{'image':image}}})
 op.candidate_config=config
 def boundary(args,**kwargs):
  calls.append(args)
  if args[:2]==['docker','build']:
   lost['value']=True;return b''
  if args[:3]==['docker','image','inspect']:
   return json.dumps([{'Id':'sha256:'+'1'*64,'Config':{'User':'node','WorkingDir':'/srv/insignia'}}]).encode()
  raise RuntimeError('UNEXPECTED_DOCKER_UP_AFTER_WORKER_LOSS')
 op.run=boundary
 try:op.deploy()
 except RuntimeError as error:
  assert str(error).startswith('Current uninstall processor readiness unqualified'),str(error)
 else:raise AssertionError('worker loss did not stop deployment')
 assert (op.APP/'.env').read_bytes()==original,'image reference changed after worker loss'
 assert not(op.APP/'.env.m5-023-new').exists()
 assert len(calls)==2 and all('up' not in call for call in calls)
 print('PASS actual decoder/deploy boundary: simulated post-build worker loss stops before image-reference write/up; external commands executed0; original env bytes preserved; one earlier simulated deploy reservation, no later mutation')
