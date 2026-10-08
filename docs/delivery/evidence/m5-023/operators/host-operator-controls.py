"""Offline failure-boundary controls only; never invoke Docker, SSH or SQL."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('host_operator', Path(__file__).with_name('host-operator.py'))
operator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)


class GuardControls(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        operator.ROOT = Path(self.directory.name)
        self.calls = []
        def denied(args, *unused, **kwargs):
            self.calls.append(args)
            raise AssertionError('External command forbidden in local controls')
        operator.run = denied

    def tearDown(self):
        self.directory.cleanup()

    def test_provision_requires_backup_before_external_command(self):
        with self.assertRaisesRegex(RuntimeError, 'Backup receipt missing'):
            operator.provision()
        self.assertEqual(self.calls, [])

    def test_deploy_requires_provision_before_external_command(self):
        with self.assertRaisesRegex(RuntimeError, 'Provisioning receipt missing'):
            operator.deploy()
        self.assertEqual(self.calls, [])

    def test_durable_reservation_is_private_and_never_replaced(self):
        operator.event('operation-reserved', {'intent': 'synthetic'})
        target = operator.ROOT / 'operation-reserved.json'
        before = target.read_bytes()
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        with self.assertRaises(FileExistsError):
            operator.event('operation-reserved', {'intent': 'different'})
        self.assertEqual(target.read_bytes(), before)
        self.assertEqual(self.calls, [])

    def test_changed_provisioning_input_stops_before_sql(self):
        (operator.ROOT / 'backup-settled.json').write_text('{}')
        (operator.ROOT / 'expected-inputs.json').write_text(json.dumps({'migrationSha256': '0' * 64, 'rolesSha256': '0' * 64}))
        (operator.ROOT / 'migration16.sql').write_text('changed input')
        (operator.ROOT / 'trusted-release-roles.sql').write_text('changed roles')
        operator.prestate = lambda: [{'Image': operator.OLD_IMAGE}]
        with self.assertRaisesRegex(RuntimeError, 'Provisioning input drift'):
            operator.provision()
        self.assertEqual(self.calls, [])
        self.assertFalse((operator.ROOT / 'provision-reserved.json').exists())


if __name__ == '__main__':
    unittest.main()
