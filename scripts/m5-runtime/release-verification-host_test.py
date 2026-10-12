"""Local operator boundaries only; no SSH, secrets, provider or production IO."""
import importlib.util
import os
import json
import subprocess
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).with_name('release-verification-host.py')
spec = importlib.util.spec_from_file_location('private_binding', SOURCE)
operator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)

class BindingControls(unittest.TestCase):
    def test_unqualified_gate_never_starts_ssh_or_creates_a_binding(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)/'not-created'
            with patch.object(operator, 'DIRECTORY', target), patch.object(operator.subprocess, 'Popen') as spawn:
                with self.assertRaises(AssertionError):
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
            with patch.object(operator, 'DIRECTORY', target), patch.object(operator,'qualify_gate') as qualify, \
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
            with self.assertRaises(AssertionError): operator.private_json(path)
            path.chmod(0o600)
            self.assertEqual(operator.private_json(path), {})
            link = Path(directory)/'link'; link.symlink_to(path)
            with self.assertRaises(OSError): operator.private_json(link)
            fifo = Path(directory)/'fifo'; os.mkfifo(fifo, 0o600)
            with self.assertRaises(AssertionError): operator.private_json(fifo)

if __name__ == '__main__': unittest.main()
