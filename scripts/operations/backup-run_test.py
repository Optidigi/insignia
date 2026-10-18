import os
from unittest.mock import patch
import importlib.util
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('backup_run', Path(__file__).with_name('backup-run.py'))
run = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(run)

@patch.dict(os.environ,{name:'' for name in ['PGSERVICE','PGSERVICEFILE','PGHOSTADDR','PGOPTIONS','DATABASE_URL']})
class WriterExclusion(unittest.TestCase):
    def test_identity_drift_has_no_stop_and_failure_resumes_only_originally_running_writers(self):
        with tempfile.TemporaryDirectory(dir='/dev/shm') as temporary:
            directory = Path(temporary)
            base = {'Id':'a'*64, 'Image':'sha256:'+'b'*64, 'Name':'/insignia-production-web',
                'Config':{'Labels':{'com.docker.compose.project':'insignia-production','com.docker.compose.service':'web'}},
                'HostConfig':{}, 'Mounts':[], 'RestartCount':0, 'State':{'Status':'running'}}
            class Docker:
                def __init__(self): self.rows = {'web':dict(base), 'worker':{**base,'Id':'c'*64,'Name':'/insignia-production-worker','Config':{'Labels':{'com.docker.compose.project':'insignia-production','com.docker.compose.service':'worker'}}, 'State':{'Status':'exited'}}}; self.actions=[]
                def inspect(self, item): return self.rows[item['service']]
                def stop(self,item): self.actions.append(('stop',item['service'])); self.rows[item['service']]['State']={'Status':'exited'}
                def start(self,item): self.actions.append(('start',item['service'])); self.rows[item['service']]['State']={'Status':'running'}
            docker = Docker()
            containers = [{ 'service':service,'name':row['Name'][1:],'id':row['Id'],'imageId':row['Image'],'configSha256':run.fingerprint(row),'healthRequired':False } for service,row in docker.rows.items()]
            config={'format':'insignia-backup-run-v1','project':'insignia-production','containers':containers,'runtimeDirectory':str(directory),'windowSeconds':300}
            bad={**config,'containers':[{**containers[0],'imageId':'sha256:'+'d'*64},containers[1]]}
            with self.assertRaises(ValueError): run.execute(bad,docker,lambda *_:None)
            self.assertEqual(docker.actions,[])
            def fail(*_): raise RuntimeError('snapshot failed')
            with self.assertRaises(RuntimeError): run.execute(config,docker,fail)
            self.assertEqual(docker.actions,[('stop','web'),('start','web')])
            self.assertFalse((directory/'window.json').exists())
            docker.actions.clear()
            def uncertain_stop(item):
                docker.actions.append(('stop',item['service']))
                raise TimeoutError('Docker response unknown')
            docker.stop = uncertain_stop
            with self.assertRaisesRegex(ValueError, 'settlement'):
                run.execute(config,docker,lambda *_:None)
            self.assertEqual(docker.actions,[('stop','web')])



@patch.dict(os.environ,{name:'' for name in ['PGSERVICE','PGSERVICEFILE','PGHOSTADDR','PGOPTIONS','DATABASE_URL']})
class InterruptedRunFence(unittest.TestCase):
    def test_second_process_refuses_prior_interruption_or_uncertain_stop_after_runtime_recreation(self):
        import json
        import os
        import shutil
        import subprocess
        import sys
        for mode in ['interrupt', 'uncertain-stop']:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory(dir='/dev/shm') as temporary:
                root = Path(temporary)
                runtime, receipts = root/'runtime', root/'receipts'
                runtime.mkdir(mode=0o700); receipts.mkdir(mode=0o700)
                row = {'Id':'a'*64,'Image':'sha256:'+'b'*64,'Name':'/insignia-production-web','Config':{'Labels':{'com.docker.compose.project':'insignia-production','com.docker.compose.service':'web'}},'HostConfig':{},'Mounts':[],'RestartCount':0,'State':{'Status':'running'}}
                (root/'state.json').write_text(json.dumps(row))
                executable = root/'docker'
                executable.write_text('''#!/usr/bin/env python3
import json,sys,pathlib
root=pathlib.Path(__file__).parent
row=json.loads((root/'state.json').read_text())
command=sys.argv[2]
if command=='inspect': print(json.dumps([row]))
elif command in ('stop','start'):
 with (root/'actions').open('a') as output: output.write(command+'\\n')
 row['State']={'Status':'exited' if command=='stop' else 'running'}
 (root/'state.json').write_text(json.dumps(row))
 if command=='stop' and (root/'uncertain').exists(): sys.exit(7)
''')
                executable.chmod(0o700)
                item={'service':'web','name':row['Name'][1:],'id':row['Id'],'imageId':row['Image'],'configSha256':run.fingerprint(row),'healthRequired':False}
                config={'format':'insignia-backup-run-v1','project':'insignia-production','containers':[item],'runtimeDirectory':str(runtime),'receiptDirectory':str(receipts),'windowSeconds':300}
                config_path=root/'config.json';config_path.write_text(json.dumps(config))
                if mode=='uncertain-stop': (root/'uncertain').touch()
                prefix=f"import runpy,json,os; m=runpy.run_path({str(Path(__file__).with_name('backup-run.py'))!r}); c=json.load(open({str(config_path)!r})); "
                first = subprocess.run([sys.executable,'-B','-c',prefix+f"m['execute'](c,m['Docker']({str(executable)!r}),lambda *_:os._exit(91))"],capture_output=True)
                self.assertNotEqual(first.returncode,0)
                self.assertEqual((root/'actions').read_text(),'stop\n')
                shutil.rmtree(runtime);runtime.mkdir(mode=0o700)  # Systemd loses /run after hard interruption.
                second = subprocess.run([sys.executable,'-B','-c',prefix+f"m['execute'](c,m['Docker']({str(executable)!r}),lambda *_:None)"],capture_output=True)
                self.assertNotEqual(second.returncode,0)
                self.assertIn(b'prior writer operation requires reconciliation',second.stderr)
                self.assertEqual((root/'actions').read_text(),'stop\n')
                self.assertEqual(json.loads((root/'state.json').read_text())['State']['Status'],'exited')

class SourceAuthority(unittest.TestCase):
    def test_alternate_libpq_authority_fails_before_any_docker_inspection_or_effect(self):
        import os
        from unittest.mock import patch
        class NoDocker:
            def inspect(self,*_): raise AssertionError('Docker must not be inspected')
        for name in ['PGSERVICE','PGSERVICEFILE','PGHOSTADDR','PGOPTIONS','DATABASE_URL']:
            with self.subTest(name=name),patch.dict(os.environ,{name:'forbidden'}):
                with self.assertRaisesRegex(ValueError,'alternate source database authority'):
                    run.execute({},NoDocker(),lambda *_:None)

if __name__ == '__main__': unittest.main()
