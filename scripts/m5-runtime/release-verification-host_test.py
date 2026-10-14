"""Local operator boundaries only; no SSH, secrets, provider or production IO."""
import importlib.util
import os
import json
import subprocess
import shutil
import hashlib
import socket
import sys
from pathlib import Path
import tempfile
import time
import uuid
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).with_name('release-verification-host.py')
spec = importlib.util.spec_from_file_location('private_binding', SOURCE)
operator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)

class BindingControls(unittest.TestCase):
    def test_exact_candidate_gate_accepts_passed_ci_after_documented_infrastructure_rerun(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            service = parent/'service'; service.write_text('synthetic qualified service')
            head = 'a'*40; tree = 'b'*40
            manifest = parent/('m5-trusted-release-launch-qualified-inputs-'+head+'.json')
            manifest.write_text(json.dumps({'reviewedHead':head,'reviewedTree':tree})); manifest.chmod(0o600)
            gate = {'version':'m5-private-collector-binding-v1','spec':'CLEAR','security':'CLEAR',
                'exactHeadCiPassed':True,'exactHeadCiAttempt1':False,
                'producerSha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
                'userServiceCrashQualified':True,'serviceSha256':hashlib.sha256(service.read_bytes()).hexdigest(),
                'head':head,'tree':tree,'inputManifestSha256':hashlib.sha256(manifest.read_bytes()).hexdigest()}
            with patch.object(operator,'PARENT',parent), patch.object(operator,'SERVICE',service), \
                 patch.object(operator.subprocess,'check_output',side_effect=[head+'\n',tree+'\n',b'']), \
                 patch.object(operator.subprocess,'run') as launch_inputs:
                operator.qualify_gate(gate)
                launch_inputs.assert_called_once()
            with patch.object(operator.subprocess,'check_output') as refs, patch.object(operator.subprocess,'run') as launch_inputs:
                with self.assertRaises(RuntimeError): operator.qualify_gate({**gate,'exactHeadCiPassed':False})
                refs.assert_not_called(); launch_inputs.assert_not_called()
            with patch.object(operator,'PARENT',parent), patch.object(operator,'SERVICE',service), \
                 patch.object(operator.subprocess,'check_output',return_value='c'*40+'\n'), \
                 patch.object(operator.subprocess,'run') as launch_inputs:
                with self.assertRaises(RuntimeError): operator.qualify_gate(gate)
                launch_inputs.assert_not_called()

    def test_oversized_socket_path_stops_before_directory_or_external_attempt(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)/'not-created'
            with patch.object(operator,'DIRECTORY',target), patch.object(operator,'REMOTE_DIRECTORY','/'+'x'*110), \
                 patch.object(operator,'qualify_gate'), patch.object(operator,'require_service'), \
                 patch.object(operator.subprocess,'Popen',side_effect=RuntimeError('unexpected_external_attempt')) as spawn:
                gate = {'head':'a'*40,'tree':'b'*40,'webContainer':'synthetic-web','webImage':'synthetic-image','databaseContainer':'synthetic-db','databaseImage':'synthetic-db-image'}
                with self.assertRaisesRegex(RuntimeError,'socket_path_unqualified'):operator.start(gate)
                spawn.assert_not_called(); self.assertFalse(target.exists())

    @unittest.skipUnless(os.environ.get('INSIGNIA_REQUIRE_USER_SERVICE_TEST') == '1', 'requires local qualified user-service manager')
    def test_abrupt_supervisor_death_closes_transport_and_detached_descendants(self):
        import configparser
        config = configparser.ConfigParser(interpolation=None); config.read(operator.SERVICE)
        service = config['Service']
        with tempfile.TemporaryDirectory() as directory:
            record = Path(directory)/'owned.json'
            unit = 'insignia-verifier-control-'+uuid.uuid4().hex+'.service'
            code = 'import subprocess,socket,json,os,time;s=socket.socket();s.bind(("127.0.0.1",0));s.listen();c=subprocess.Popen(["sleep","60"],start_new_session=True);open('+repr(str(record))+',"w").write(json.dumps({"parent":os.getpid(),"child":c.pid,"port":s.getsockname()[1]}));time.sleep(60)'
            try:
                subprocess.run(['systemd-run','--user','--unit='+unit,'--property=Type='+service['Type'],
                    '--property=KillMode='+service['KillMode'],'--property=Restart='+service['Restart'],
                    '--property=TimeoutStopSec='+service['TimeoutStopSec'],sys.executable,'-B','-c',code],
                    capture_output=True,check=True,timeout=5)
                for _ in range(100):
                    if record.exists(): break
                    time.sleep(.05)
                owned = json.loads(record.read_text())
                subprocess.run(['systemctl','--user','kill','--kill-whom=main','--signal=KILL',unit],check=True,timeout=5)
                for _ in range(100):
                    if not any(Path('/proc',str(owned[key])).exists() for key in ['parent','child']):break
                    time.sleep(.05)
                self.assertFalse(any(Path('/proc',str(owned[key])).exists() for key in ['parent','child']))
                import socket
                with self.assertRaises(OSError):socket.create_connection(('127.0.0.1',owned['port']),timeout=.2)
                self.assertEqual(json.loads(record.read_text()),owned)
            finally:
                subprocess.run(['systemctl','--user','stop',unit],capture_output=True,timeout=20)
                subprocess.run(['systemctl','--user','reset-failed',unit],capture_output=True,timeout=5)

    def test_optimized_interpreter_cannot_accept_a_public_gate_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'gate.json'; path.write_text('{}'); path.chmod(0o644)
            code = "import importlib.util;s=importlib.util.spec_from_file_location('binding',"+repr(str(SOURCE))+");m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.private_json("+repr(str(path))+")"
            result = subprocess.run([sys.executable,'-B','-O','-c',code],capture_output=True,timeout=5)
            self.assertNotEqual(result.returncode,0)

    def test_unqualified_gate_never_starts_ssh_or_creates_a_binding(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)/'not-created'
            with patch.object(operator, 'DIRECTORY', target), patch.object(operator.subprocess, 'Popen') as spawn:
                with self.assertRaises(RuntimeError):
                    operator.start({'version':'m5-private-collector-binding-v1','spec':'CLEAR','security':'CHANGES_REQUESTED','exactHeadCiAttempt1':True})
                spawn.assert_not_called()
                self.assertFalse(target.exists())

    def test_private_startup_uses_real_owned_processes_and_separate_loopback_transport(self):
        self.run_private_startup()

    def test_reviewed_m8_profile_reaches_real_receiver_without_changing_packet(self):
        self.run_private_startup('m8-read-orders-617057f')

    def test_reviewed_app_proxy_profile_reaches_real_receiver_without_changing_packet(self):
        self.run_private_startup('m8-app-proxy-3d2a02e')

    def test_stopped_bridge_reuse_keeps_inode_and_records_one_handover(self):
        self.run_private_startup('m8-read-orders-617057f', reuse=True)

    def test_receiver_startup_failure_retains_handover_and_exclusive_fence(self):
        self.run_private_startup('m8-read-orders-617057f', reuse=True, fail_receiver=True)

    def run_private_startup(self, profile=None, reuse=False, fail_receiver=False):
        real_spawn = subprocess.Popen
        test_node = shutil.which('node')
        self.assertIsNotNone(test_node, 'local controls require the workflow-installed Node runtime')
        children = []
        transport_arguments = []
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)/'binding'
            gate = {'head':'a'*40,'tree':'b'*40,'webContainer':'synthetic-web','webImage':'synthetic-image',
                    'databaseContainer':'synthetic-db','databaseImage':'synthetic-db-image'}
            if profile: gate['releaseProfile'] = profile
            prior = None
            if reuse:
                import hashlib
                target.mkdir(mode=0o700)
                record = {'version':'m5-private-binding-intent-v1','head':'c'*40,'tree':'d'*40,
                    'operation':'CREATE_PRIVATE_METADATA_BRIDGE','retryAuthorized':False}
                intent = target/'binding-intent.json'; intent.write_text(json.dumps(record)); intent.chmod(0o600)
                prior = intent.read_bytes(); inode = target.stat().st_ino
                gate['bridgeReuse'] = {'localInode':inode,'remoteInode':123,
                    'priorBindingIntentSha256':hashlib.sha256(prior).hexdigest(),
                    'priorMainPid':99999999,'priorInvocationId':'a'*32}
            def external(command, **kwargs):
                if '--input-type=module' in command:
                    self.assertEqual(command[0],test_node)
                    return real_spawn(command, **kwargs)
                if command[0] == 'ssh' and '-N' not in command:
                    private = {'clientSecret':'SYNTHETIC_SECRET','databaseUrl':'postgres://insignia_runtime:synthetic@private/db',
                        'appendPassword':'a'*64,'databaseIp':'127.0.0.1'}
                    code = 'import json;print(json.dumps('+repr(private)+'))'
                elif command[0] == 'ssh':
                    transport_arguments.extend(command)
                    port = int(command[command.index('-L')+1].split(':')[1])
                    code = 'import socket,time;s=socket.socket();s.bind(("127.0.0.1",'+str(port)+'));s.listen();time.sleep(60)'
                else:
                    self.assertEqual(command[2:], [profile] if profile else [])
                    code = "import json,sys,urllib.parse;p=json.load(sys.stdin);assert set(p)=={'recordId','clientSecret','appendPassword','databaseUrl'};assert urllib.parse.urlsplit(p['databaseUrl']).hostname=='127.0.0.1';print('{\"classification\":\"PRIVATE_COLLECTOR_LISTENING_NOT_NATIVE_QUALIFICATION\"}',flush=True)"
                if fail_receiver and command[0] != 'ssh': code = 'import sys;sys.exit(1)'
                child = real_spawn([sys.executable,'-c',code],**kwargs)
                children.append(child)
                return child
            with patch.object(operator, 'DIRECTORY', target), patch.object(operator,'qualify_gate') as qualify, patch.object(operator,'require_service'), \
                 patch.object(operator.subprocess,'Popen',side_effect=external), patch.object(operator,'PARENT',Path(directory)), \
                 patch.object(operator,'qualify_stopped_invocation'), patch.object(operator,'NODE',test_node):
                if fail_receiver:
                    with self.assertRaises(RuntimeError): operator.start(gate)
                else: operator.start(gate)
                qualify.assert_called_once_with(gate)
            if reuse:
                self.assertEqual(target.stat().st_ino,inode)
                self.assertEqual((target/'binding-intent.json').read_bytes(),prior)
                self.assertTrue((target/('binding-handover-'+gate['head']+'.json')).exists())
                self.assertEqual((Path(directory)/'m5-trusted-release-launch-exclusive').exists(),fail_receiver)
            self.assertTrue(all(child.poll() is not None for child in children))
            for child in children:
                for stream in (child.stdin, child.stdout, child.stderr):
                    if stream is not None: stream.close()
            self.assertEqual(json.loads((target/'binding-intent.json').read_text())['retryAuthorized'],False)
            self.assertIn('StreamLocalBindUnlink=no',transport_arguments)
            self.assertIn('StreamLocalBindMask=0177',transport_arguments)

    def test_unknown_profile_stops_before_qualification_secret_reads_or_ssh(self):
        for profile in [None, '', 'm8-guessed', ['m8-read-orders-617057f']]:
            with self.subTest(profile=profile), tempfile.TemporaryDirectory() as directory:
                target = Path(directory)/'not-created'
                with patch.object(operator, 'DIRECTORY', target), patch.object(operator, 'qualify_gate') as qualify, \
                     patch.object(operator, 'require_service') as service, patch.object(operator.subprocess, 'Popen') as spawn:
                    with self.assertRaisesRegex(RuntimeError, 'release_profile_unqualified'):
                        operator.start({'releaseProfile':profile})
                    qualify.assert_not_called(); service.assert_not_called(); spawn.assert_not_called()
                    self.assertFalse(target.exists())

    def test_existing_bridge_and_live_socket_are_preserved_and_never_reclaimed(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)/'bridge'; target.mkdir(mode=0o700)
            intent = target/'binding-intent.json'; intent.write_text('retained historical intent')
            inode = target.stat().st_ino
            with socket.socket(socket.AF_UNIX) as listener:
                listener.bind(str(target/'collector.sock')); listener.listen()
                socket_inode = (target/'collector.sock').lstat().st_ino
                with patch.object(operator,'DIRECTORY',target), patch.object(operator,'qualify_gate'), \
                     patch.object(operator,'require_service'), patch.object(operator.subprocess,'Popen') as spawn:
                    with self.assertRaises(RuntimeError): operator.start({'head':'a'*40,'tree':'b'*40})
                    spawn.assert_not_called()
                self.assertEqual(target.stat().st_ino,inode)
                self.assertEqual((target/'collector.sock').lstat().st_ino,socket_inode)
                self.assertEqual(intent.read_text(),'retained historical intent')
                with socket.socket(socket.AF_UNIX) as client: client.connect(str(target/'collector.sock'))

    def test_symlink_bridge_is_rejected_without_touching_its_target(self):
        with tempfile.TemporaryDirectory() as directory:
            real = Path(directory)/'real'; real.mkdir(mode=0o700)
            target = Path(directory)/'bridge'; target.symlink_to(real, target_is_directory=True)
            inode = real.stat().st_ino
            with patch.object(operator,'DIRECTORY',target), patch.object(operator,'qualify_gate'), \
                 patch.object(operator,'require_service'), patch.object(operator.subprocess,'Popen') as spawn:
                with self.assertRaises(RuntimeError): operator.start({'head':'a'*40,'tree':'b'*40})
                spawn.assert_not_called()
            self.assertTrue(target.is_symlink()); self.assertEqual(real.stat().st_ino,inode)
            self.assertEqual(list(real.iterdir()),[])

    def test_gate_bound_stopped_bridge_reuse_preserves_directory_and_prior_intent(self):
        import hashlib
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)/'bridge'; target.mkdir(mode=0o700)
            intent = target/'binding-intent.json'
            intent.write_text(json.dumps({'version':'m5-private-binding-intent-v1',
                'head':'a'*40,'tree':'b'*40,'operation':'CREATE_PRIVATE_METADATA_BRIDGE','retryAuthorized':False}))
            intent.chmod(0o600)
            raw = intent.read_bytes(); inode = target.stat().st_ino
            reuse = {'localInode':inode,'remoteInode':123,
                'priorBindingIntentSha256':hashlib.sha256(raw).hexdigest(),
                'priorMainPid':99999999,'priorInvocationId':'a'*32}
            with patch.object(operator,'DIRECTORY',target):
                operator.qualify_bridge_reuse(reuse)
                for key, changed in [('localInode',inode+1),('priorBindingIntentSha256','0'*64)]:
                    with self.subTest(key=key), self.assertRaisesRegex(RuntimeError,'bridge_reuse_unqualified'):
                        operator.qualify_bridge_reuse({**reuse,key:changed})
            self.assertEqual(target.stat().st_ino,inode); self.assertEqual(intent.read_bytes(),raw)
            with socket.socket(socket.AF_UNIX) as listener:
                listener.bind(str(target/'collector.sock')); listener.listen()
                with patch.object(operator,'DIRECTORY',target):
                    with self.assertRaisesRegex(RuntimeError,'bridge_reuse_unqualified'):
                        operator.qualify_bridge_reuse(reuse)

    def test_incomplete_reuse_never_reads_secrets_or_attempts_ssh(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)/'not-created'
            with patch.object(operator,'DIRECTORY',target), patch.object(operator,'qualify_gate'), \
                 patch.object(operator,'require_service'), patch.object(operator.subprocess,'Popen') as spawn:
                for reuse in [None, {}, {'localInode':1}]:
                    with self.assertRaisesRegex(RuntimeError,'bridge_reuse_unqualified'):
                        operator.start({'bridgeReuse':reuse})
                spawn.assert_not_called(); self.assertFalse(target.exists())

    def test_remote_reuse_rejects_live_socket_before_secret_or_container_custody(self):
        with tempfile.TemporaryDirectory() as directory:
            bridge = Path(directory)/'bridge'; bridge.mkdir(mode=0o700)
            code = operator.REMOTE.replace('/home/serveradmin/insignia-m5-verify-20261012-r2',str(bridge))
            with socket.socket(socket.AF_UNIX) as listener:
                listener.bind(str(bridge/'collector.sock')); listener.listen()
                inode = bridge.stat().st_ino
                with patch.object(subprocess,'check_output') as read:
                    with self.assertRaisesRegex(RuntimeError,'remote_binding_unqualified'):
                        exec(code, {'G':{'bridgeReuse':{'remoteInode':inode}}})
                    read.assert_not_called()
                self.assertEqual(bridge.stat().st_ino,inode)
                self.assertTrue((bridge/'collector.sock').exists())

    def test_remote_reuse_rejects_changed_inode_or_symlink_before_custody(self):
        with tempfile.TemporaryDirectory() as directory:
            bridge = Path(directory)/'bridge'; bridge.mkdir(mode=0o700)
            link = Path(directory)/'link'; link.symlink_to(bridge, target_is_directory=True)
            for selected, inode in [(bridge,bridge.stat().st_ino+1),(link,bridge.stat().st_ino)]:
                code = operator.REMOTE.replace('/home/serveradmin/insignia-m5-verify-20261012-r2',str(selected))
                with self.subTest(path=selected), patch.object(subprocess,'check_output') as read:
                    with self.assertRaisesRegex(RuntimeError,'remote_binding_unqualified'):
                        exec(code, {'G':{'bridgeReuse':{'remoteInode':inode}}})
                    read.assert_not_called()
            self.assertTrue(link.is_symlink()); self.assertEqual(list(bridge.iterdir()),[])

    def test_prior_service_invocation_must_differ_from_current(self):
        with patch.object(operator.subprocess,'check_output',return_value='a'*32+'\n'):
            with self.assertRaisesRegex(RuntimeError,'prior_service_not_stopped'):
                operator.qualify_stopped_invocation({'priorInvocationId':'a'*32})
        with patch.object(operator.subprocess,'check_output',return_value='b'*32+'\n'):
            operator.qualify_stopped_invocation({'priorInvocationId':'a'*32})

    def test_gate_requires_private_regular_file_before_parsing(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'gate.json'
            path.write_text('{}'); path.chmod(0o644)
            with self.assertRaises(RuntimeError): operator.private_json(path)
            path.chmod(0o600)
            self.assertEqual(operator.private_json(path), {})
            link = Path(directory)/'link'; link.symlink_to(path)
            with self.assertRaises(OSError): operator.private_json(link)
            fifo = Path(directory)/'fifo'; os.mkfifo(fifo, 0o600)
            with self.assertRaises(RuntimeError): operator.private_json(fifo)

if __name__ == '__main__': unittest.main()
