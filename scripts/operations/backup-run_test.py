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
    def test_host_inspector_drains_before_capture_and_recovers_before_containers(self):
        for failure in [None, 'capture', 'stop', 'ready', 'identity', 'reactivation', 'inactive', 'jobs', 'prestop-restart']:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory(dir='/dev/shm') as temporary:
                directory=Path(temporary); actions=[]
                row={'Id':'a'*64,'Image':'sha256:'+'b'*64,'Name':'/insignia-production-web','Config':{'Labels':{'com.docker.compose.project':'insignia-production','com.docker.compose.service':'web'}},'HostConfig':{},'Mounts':[],'RestartCount':0,'State':{'Status':'running'}}
                class Docker:
                    def inspect(self,item): return row
                    def stop(self,item):
                        actions.append('web-stop'); row['State']={'Status':'exited'}
                        if failure=='prestop-restart': inspector.invocation='replacement'
                    def start(self,item): actions.append('web-start'); row['State']={'Status':'running'}
                class Inspector:
                    def __init__(self): self.running=failure!='inactive'; self.invocation='old'
                    def inspect(self): return {'status':'running' if self.running else 'exited','invocation':self.invocation,'configSha256':'c'*64 if failure!='identity' else 'd'*64,'jobs':failure=='jobs','socket':self.running}
                    def ready(self): return self.running and not (failure=='ready' and self.invocation=='new')
                    def verify_artifact(self): pass
                    def stop(self):
                        actions.append('inspector-stop')
                        if failure=='stop': raise TimeoutError('unknown inspector stop')
                        self.running=False
                    def start(self): actions.append('inspector-start'); self.running=True; self.invocation='new'
                inspector=Inspector()
                item={'service':'web','name':row['Name'][1:],'id':row['Id'],'imageId':row['Image'],'configSha256':run.fingerprint(row),'healthRequired':False}
                config={'format':'insignia-backup-run-v1','project':'insignia-production','containers':[item],'runtimeDirectory':str(directory),'windowSeconds':300,'hostInspector':{'unit':'insignia-artwork-inspection.service','configSha256':'c'*64}}
                def capture(window, stopped):
                    actions.append('capture'); self.assertFalse(inspector.running); self.assertEqual(row['State']['Status'],'exited')
                    if failure=='reactivation': inspector.running=True
                    stopped()
                    if failure=='capture': raise RuntimeError('snapshot failed')
                if failure in (None,'inactive'): run.execute(config,Docker(),capture,inspector)
                else:
                    with self.assertRaises((ValueError,RuntimeError,TimeoutError)): run.execute(config,Docker(),capture,inspector)
                self.assertFalse((directory/'window.json').exists())
                if failure in ('identity','jobs'): self.assertEqual(actions,[])
                elif failure=='inactive': self.assertEqual(actions,['web-stop','capture','web-start'])
                elif failure=='stop': self.assertNotIn('capture',actions); self.assertNotIn('inspector-start',actions)
                elif failure=='ready': self.assertNotIn('web-start',actions)
                elif failure=='reactivation': self.assertNotIn('inspector-start',actions); self.assertNotIn('web-start',actions)
                elif failure=='prestop-restart': self.assertEqual(actions,['web-stop'])
                else: self.assertEqual(actions,['web-stop','inspector-stop','capture','inspector-start','web-start'])

    def test_deployed_split_projects_are_excluded_together_and_foreign_project_never_stops(self):
        with tempfile.TemporaryDirectory(dir='/dev/shm') as temporary:
            directory = Path(temporary)
            rows = {}
            for index, (service, project) in enumerate([('web','insignia-rewrite-m5-019'),('worker','insignia-uninstall-m5-024'),('verifier','insignia-release-verifier')]):
                rows[service] = {'Id':str(index+1)*64,'Image':'sha256:'+'b'*64,'Name':'/'+project+'-'+service+'-1',
                    'Config':{'Labels':{'com.docker.compose.project':project,'com.docker.compose.service':service}},
                    'HostConfig':{},'Mounts':[],'RestartCount':0,'State':{'Status':'running'}}
            class Docker:
                def __init__(self): self.actions=[]
                def inspect(self,item): return rows[item['service']]
                def stop(self,item): self.actions.append(('stop',item['service'])); rows[item['service']]['State']={'Status':'exited'}
                def start(self,item): self.actions.append(('start',item['service'])); rows[item['service']]['State']={'Status':'running'}
            docker = Docker()
            items = [{'project':row['Config']['Labels']['com.docker.compose.project'],'service':service,'name':row['Name'][1:],
                'id':row['Id'],'imageId':row['Image'],'configSha256':run.fingerprint(row),'healthRequired':False} for service,row in rows.items()]
            config={'format':'insignia-backup-run-v1','project':'insignia-backup','containers':items,'runtimeDirectory':str(directory),'windowSeconds':300}
            bad = {**config,'containers':[{**items[0],'project':'insignia-other'},*items[1:]]}
            with self.assertRaises(ValueError): run.execute(bad,docker,lambda *_:None)
            self.assertEqual(docker.actions,[])
            def capture(window, stopped):
                self.assertTrue(window.exists()); stopped()
                self.assertTrue(all(row['State']['Status']=='exited' for row in rows.values()))
            run.execute(config,docker,capture)
            self.assertEqual(docker.actions,[('stop','web'),('stop','worker'),('stop','verifier'),('start','verifier'),('start','worker'),('start','web')])
            self.assertFalse((directory/'window.json').exists())

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
        for mode in ['interrupt', 'uncertain-stop', 'inspector-interrupt', 'inspector-uncertain-stop']:
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
 row['State']={'Status':'exited' if command=='stop' else 'running','ExitCode':0,'OOMKilled':False}
 (root/'state.json').write_text(json.dumps(row))
 if command=='stop' and (root/'uncertain').exists(): sys.exit(7)
''')
                executable.chmod(0o700)
                item={'service':'web','name':row['Name'][1:],'id':row['Id'],'imageId':row['Image'],'configSha256':run.fingerprint(row),'healthRequired':False}
                config={'format':'insignia-backup-run-v1','project':'insignia-production','containers':[item],'runtimeDirectory':str(runtime),'receiptDirectory':str(receipts),'windowSeconds':300}
                if mode.startswith('inspector-'):
                    config['hostInspector']={'unit':'insignia-artwork-inspection.service','configSha256':'c'*64}
                config_path=root/'config.json';config_path.write_text(json.dumps(config))
                if mode=='uncertain-stop': (root/'uncertain').touch()
                prefix=f"import runpy,json,os; m=runpy.run_path({str(Path(__file__).with_name('backup-run.py'))!r}); c=json.load(open({str(config_path)!r})); "
                adapter='None'
                if mode.startswith('inspector-'):
                    # Separate process/OS boundary; original durable operator still runs.
                    prefix += "\nclass Inspector:\n def __init__(self): self.running=True\n def inspect(self): return {'status':'running' if self.running else 'exited','invocation':'old','configSha256':'c'*64,'jobs':False,'socket':self.running}\n def ready(self): return True\n def verify_artifact(self): pass\n def stop(self):\n  self.running=False\n"
                    if mode=='inspector-uncertain-stop': prefix += "  raise TimeoutError('unknown host service stop')\n"
                    prefix += " def start(self): raise AssertionError('unsettled inspector must not restart')\n"
                    adapter='Inspector()'
                first = subprocess.run([sys.executable,'-B','-c',prefix+f"\nm['execute'](c,m['Docker']({str(executable)!r}),lambda *_:os._exit(91),{adapter})"],capture_output=True)
                self.assertNotEqual(first.returncode,0)
                self.assertEqual((root/'actions').read_text(),'stop\n')
                shutil.rmtree(runtime);runtime.mkdir(mode=0o700)  # Systemd loses /run after hard interruption.
                second = subprocess.run([sys.executable,'-B','-c',prefix+f"\nm['execute'](c,m['Docker']({str(executable)!r}),lambda *_:None,{adapter})"],capture_output=True)
                self.assertNotEqual(second.returncode,0)
                self.assertIn(b'prior writer operation requires reconciliation',second.stderr)
                self.assertEqual((root/'actions').read_text(),'stop\n')
                self.assertEqual(json.loads((root/'state.json').read_text())['State']['Status'],'exited')

class SourceAuthority(unittest.TestCase):
    def test_docker_drain_never_escalates_to_kill_and_unclean_exit_is_unsettled(self):
        import json
        with tempfile.TemporaryDirectory(dir='/dev/shm') as temporary:
            root=Path(temporary); executable=root/'docker'
            executable.write_text('''#!/usr/bin/env python3
import sys,json,pathlib
root=pathlib.Path(__file__).parent
if sys.argv[2]=='stop':
 assert sys.argv[3:5]==['--timeout','-1'], 'forced Docker kill is forbidden'
else: print(json.dumps([{'State':json.loads((root/'state').read_text())}]))
''')
            executable.chmod(0o700)
            docker=run.Docker(str(executable)); item={'id':'a'*64}
            (root/'state').write_text(json.dumps({'Status':'exited','ExitCode':0,'OOMKilled':False}))
            docker.stop(item)
            (root/'state').write_text(json.dumps({'Status':'exited','ExitCode':137,'OOMKilled':False}))
            with self.assertRaisesRegex(ValueError,'drain'): docker.stop(item)

    def test_changed_inspector_bootstrap_or_runtime_rejects_even_when_manifest_is_unchanged(self):
        import hashlib, json
        with tempfile.TemporaryDirectory(dir='/dev/shm') as temporary:
            root=Path(temporary); (root/'bin').mkdir(mode=0o700)
            (root/'start.mjs').write_bytes(b'qualified bootstrap'); (root/'start.mjs').chmod(0o400)
            (root/'bin/node').write_bytes(b'qualified runtime'); (root/'bin/node').chmod(0o500)
            manifest={'version':'insignia-artwork-inspector-artifact-v1','files':{name:{'kind':'file','mode':(root/name).stat().st_mode & 0o777,'sha256':hashlib.sha256((root/name).read_bytes()).hexdigest()} for name in ['start.mjs','bin/node']}}
            raw=json.dumps(manifest).encode(); (root/'manifest.json').write_bytes(raw)
            digest=hashlib.sha256(raw).hexdigest()
            run.verify_inspector_artifact(root,digest)
            for name in ['start.mjs','bin/node']:
                original=(root/name).read_bytes(); mode=(root/name).stat().st_mode & 0o777
                (root/name).chmod(0o600); (root/name).write_bytes(b'tampered bootstrap/runtime'); (root/name).chmod(mode)
                with self.assertRaisesRegex(ValueError,'artifact'): run.verify_inspector_artifact(root,digest)
                (root/name).chmod(0o600); (root/name).write_bytes(original); (root/name).chmod(mode)

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
