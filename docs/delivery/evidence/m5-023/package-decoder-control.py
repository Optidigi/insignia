import importlib.util,json,tempfile
from pathlib import Path
r=Path('/home/serveradmin/insignia-m5-023-worktree')
n=Path('/home/serveradmin/insignia-m5-023-handoff')
s=importlib.util.spec_from_file_location('op',r/'docs/delivery/evidence/m5-023/operators/host-operator.py');o=importlib.util.module_from_spec(s);s.loader.exec_module(o)
with tempfile.TemporaryDirectory() as d:
 o.ROOT=Path(d);(o.ROOT/'expected-inputs.json').write_bytes((n/'expected-inputs.json').read_bytes());(o.ROOT/'provision-settled.json').write_text('{}')
 for name in ['reviewed-web-package.tar.gz','package-inventory.json','build-context']:(o.ROOT/name).symlink_to(n/name)
 o.require_lifecycle=lambda:None;o.prestate=lambda:[{'Image':o.OLD_IMAGE}]
 calls=[]
 def denied(args,**kw):
  calls.append(args)
  assert args[:2]==['docker','build'], 'unexpected boundary'
  raise RuntimeError('QUALIFIED_CONTEXT_REACHED_BUILD_BOUNDARY')
 o.run=denied
 try:o.deploy()
 except RuntimeError as e:
  assert str(e)=='QUALIFIED_CONTEXT_REACHED_BUILD_BOUNDARY';assert len(calls)==1
 else:raise AssertionError('no build boundary')
 print('PASS actual reviewed context/inventory decoded before denied Docker build; external commands executed=0')
