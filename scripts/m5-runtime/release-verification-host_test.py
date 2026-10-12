"""Local operator boundaries only; no SSH, secrets, provider or production IO."""
import importlib.util
import os
import json
import subprocess
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
        real_spawn = subprocess.Popen
        children = []
        transport_arguments = []
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)/'binding'
            gate = {'head':'a'*40,'tree':'b'*40,'webContainer':'synthetic-web','webImage':'synthetic-image',
                    'databaseContainer':'synthetic-db','databaseImage':'synthetic-db-image'}
            def external(command, **kwargs):
                if command[0] == 'ssh' and '-N' not in command:
                    private = {'clientSecret':'SYNTHETIC_SECRET','databaseUrl':'postgres://insignia_runtime:synthetic@private/db',
                        'appendPassword':'a'*64,'databaseIp':'127.0.0.1'}
                    code = 'import json;print(json.dumps('+repr(private)+'))'
                elif command[0] == 'ssh':
                    transport_arguments.extend(command)
                    port = int(command[command.index('-L')+1].split(':')[1])
                    code = 'import socket,time;s=socket.socket();s.bind(("127.0.0.1",'+str(port)+'));s.listen();time.sleep(60)'
                else:
                    code = "import json,sys,urllib.parse;p=json.load(sys.stdin);assert set(p)=={'recordId','clientSecret','appendPassword','databaseUrl'};assert urllib.parse.urlsplit(p['databaseUrl']).hostname=='127.0.0.1';print('{\"classification\":\"PRIVATE_COLLECTOR_LISTENING_NOT_NATIVE_QUALIFICATION\"}',flush=True)"
                child = real_spawn([sys.executable,'-c',code],**kwargs)
                children.append(child)
                return child
            with patch.object(operator, 'DIRECTORY', target), patch.object(operator,'qualify_gate') as qualify, patch.object(operator,'require_service'), \
                 patch.object(operator.subprocess,'Popen',side_effect=external):
                operator.start(gate)
                qualify.assert_called_once_with(gate)
            self.assertTrue(all(child.poll() is not None for child in children))
            self.assertEqual(json.loads((target/'binding-intent.json').read_text())['retryAuthorized'],False)
            self.assertIn('StreamLocalBindUnlink=no',transport_arguments)
            self.assertIn('StreamLocalBindMask=0177',transport_arguments)

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
