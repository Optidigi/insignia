"""Offline failure-boundary controls only; never invoke Docker, SSH or SQL."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('host_operator', Path(__file__).with_name('host-operator.py'))
operator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)
original_prestate = operator.prestate
original_qualification = operator.qualify_lifecycle


class GuardControls(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        operator.ROOT = Path(self.directory.name)
        operator.APP = operator.ROOT / 'app'
        operator.APP.mkdir()
        (operator.APP / 'compose.yaml').write_bytes(Path(__file__).with_name('expected-compose.yaml').read_bytes())
        operator.prestate = original_prestate
        # Current-qualification seam for reservation/configuration unit controls;
        # the full lifecycle transition controls below use the actual qualifier.
        operator.qualify_lifecycle = lambda: {'classification': 'PASS_UNINSTALL_PROCESSOR',
            'candidateConfigSha256': operator.candidate_config(operator.OLD_IMAGE)[4]}
        self.calls = []
        self.config = {'services': {'web': {'image': operator.OLD_IMAGE,
            'environment': {'APP_URL': operator.ORIGIN},
            'networks': {'backend': {}},
            'labels': {'traefik.enable': 'true',
                'traefik.http.routers.insignia-canonical-m5-019r.rule': 'Host(`insignia-app.optidigi.nl`)'}}},
            'networks': {'backend': {'name': 'backend'}}}
        def denied(args, *unused, **kwargs):
            self.calls.append(args)
            if 'config' in args:
                return json.dumps(self.config).encode()
            raise AssertionError('External command forbidden in local controls')
        operator.run = denied

    def qualified_receipt(self):
        # Qualify one fixed fake external Compose response, then exercise subsequent drift.
        _, _, _, _, digest, _ = operator.candidate_config(operator.OLD_IMAGE)
        self.calls.clear()
        (operator.ROOT / 'lifecycle-settled.json').write_text(json.dumps({
            'classification': 'PASS_UNINSTALL_PROCESSOR', 'candidateConfigSha256': digest}))

    def tearDown(self):
        self.directory.cleanup()

    def test_provision_requires_backup_before_external_command(self):
        self.qualified_receipt()
        with self.assertRaisesRegex(RuntimeError, 'Backup receipt missing'):
            operator.provision()
        self.assertEqual(len(self.calls), 1)
        self.assertIn('config', self.calls[0])

    def test_deploy_requires_provision_before_external_command(self):
        self.qualified_receipt()
        with self.assertRaisesRegex(RuntimeError, 'Provisioning receipt missing'):
            operator.deploy()
        self.assertEqual(len(self.calls), 1)
        self.assertIn('config', self.calls[0])

    def test_changed_compose_source_stops_before_any_external_command(self):
        self.qualified_receipt()
        with (operator.APP / 'compose.yaml').open('ab') as stream:
            stream.write(b'\n# unreviewed source change\n')
        for action in [operator.lifecycle, operator.backup, operator.provision, operator.deploy]:
            with self.assertRaisesRegex(RuntimeError, 'Reviewed Compose source drift'):
                action()
        self.assertEqual(self.calls, [])
        self.assertFalse(list(operator.ROOT.glob('*-reserved.json')))

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
        self.qualified_receipt()
        (operator.ROOT / 'backup-settled.json').write_text('{}')
        (operator.ROOT / 'expected-inputs.json').write_text(json.dumps({'migrationSha256': '0' * 64, 'rolesSha256': '0' * 64}))
        (operator.ROOT / 'migration16.sql').write_text('changed input')
        (operator.ROOT / 'trusted-release-roles.sql').write_text('changed roles')
        operator.prestate = lambda: [{'Image': operator.OLD_IMAGE}]
        with self.assertRaisesRegex(RuntimeError, 'Provisioning input drift'):
            operator.provision()
        self.assertEqual(len(self.calls), 1)
        self.assertIn('config', self.calls[0])
        self.assertFalse((operator.ROOT / 'provision-reserved.json').exists())

    def test_inherited_compose_override_cannot_select_unreviewed_image(self):
        # External Compose boundary: its environment takes precedence over .env.
        # A configuration mismatch must stop before the mutating `up` command.
        def compose(args, stdin=None, timeout=60, env=None):
            self.calls.append(args)
            effective = {**os.environ, **(env or {})}
            if 'config' in args:
                return json.dumps({'services': {'web': {
                    'image': effective['INSIGNIA_WEB_IMAGE'],
                    'environment': {'APP_URL': operator.ORIGIN}, 'networks': {'backend': {}},
                    'labels': {'traefik.enable': effective['INSIGNIA_ROUTE_ENABLED'],
                               'traefik.http.routers.insignia-canonical-m5-019r.rule': 'Host(`insignia-app.optidigi.nl`)'},
                }}, 'networks': {'backend': {'name': 'backend'}}}).encode()
            self.assertEqual(args[args.index('-f') + 1], '-')
            self.assertEqual(args[args.index('--env-file') + 1], '/dev/null')
            self.assertEqual(json.loads(stdin)['services']['web']['environment']['APP_URL'], operator.ORIGIN)
            self.assertEqual(effective['INSIGNIA_WEB_IMAGE'], 'sha256:' + '1' * 64)
            self.assertEqual(effective['INSIGNIA_ROUTE_ENABLED'], 'true')
            return b''
        self.qualified_receipt()
        operator.run = compose
        with patch.dict(os.environ, {'INSIGNIA_WEB_IMAGE': 'unreviewed', 'INSIGNIA_ROUTE_ENABLED': 'false'}):
            operator.compose_web('sha256:' + '1' * 64)
        self.assertEqual(len(self.calls), 3)
        self.assertIn('up', self.calls[2])

    def test_resolved_compose_drift_stops_before_up(self):
        self.qualified_receipt()
        def drift(args, *unused, **kwargs):
            self.calls.append(args)
            return json.dumps({'services': {'web': {'image': 'unreviewed'}}}).encode()
        operator.run = drift
        with self.assertRaisesRegex(RuntimeError, 'Resolved Compose'):
            operator.compose_web('sha256:' + '1' * 64)
        self.assertEqual(len(self.calls), 1)
        self.assertNotIn('up', self.calls[0])

    def test_unqualified_lifecycle_stops_before_any_backup_or_deploy_command(self):
        for action in [operator.backup, operator.provision, operator.deploy]:
            with self.assertRaisesRegex(RuntimeError, 'Uninstall processor readiness unqualified'):
                action()
        self.assertEqual(self.calls, [])

    def test_qualified_configuration_drift_blocks_every_mutation(self):
        self.qualified_receipt()
        self.config['services']['web']['environment']['DATABASE_URL'] = 'changed-after-qualification'
        for action in [operator.backup, operator.provision, operator.deploy]:
            with self.assertRaisesRegex(RuntimeError, 'Qualified candidate configuration drift'):
                action()
        self.assertTrue(all('config' in call for call in self.calls))
        self.assertFalse(list(operator.ROOT.glob('*-reserved.json')))
        with self.assertRaisesRegex(RuntimeError, 'Qualified candidate configuration drift'):
            operator.compose_web(operator.OLD_IMAGE)
        self.assertTrue(all('config' in call for call in self.calls))

    def test_read_only_missing_worker_classifies_and_never_provisions(self):
        operator.qualify_lifecycle = original_qualification
        environment = ['DATABASE_URL=postgres://synthetic@database:5432/insignia_rewrite',
                       'SHOPIFY_CLIENT_SECRET=synthetic', 'SHOPIFY_WEBHOOK_SECRET=synthetic']
        web = {'Config': {'Env': environment, 'Cmd': ['node', 'entry.mjs']}}
        operator.prestate = lambda: [web]
        (operator.ROOT / 'expected-inputs.json').write_text('{}')
        def boundary(args, *unused, **kwargs):
            self.calls.append(args)
            if 'config' in args:
                return json.dumps(self.config).encode()
            if args[:3] == ['docker', 'ps', '-q']:
                return b'synthetic-container\n'
            if args[:2] == ['docker', 'inspect']:
                return json.dumps([web]).encode()
            if 'psql' in args:
                return b'{"queueSchemaPresent":false,"queueRuntimeUsable":false}'
            raise AssertionError('Unexpected external command')
        operator.run = boundary
        operator.lifecycle()
        value = json.loads((operator.ROOT / 'lifecycle-settled.json').read_text())
        self.assertEqual(value['classification'], 'BLOCKED_UNINSTALL_PROCESSOR_READINESS')
        self.assertEqual(value['candidateCount'], 0)
        self.assertEqual(value['databaseWrites'], 0)
        self.assertFalse((operator.ROOT / 'provision-reserved.json').exists())
        self.assertNotIn('synthetic@', json.dumps(value))

    def test_only_exact_ready_worker_and_queue_qualify(self):
        operator.qualify_lifecycle = original_qualification
        for failure in [None, 'artifact', 'secret', 'queue', 'health', 'dependency', 'role', 'application-rights', 'writable-code', 'custom-launcher', 'separate-network', 'dns-drift', 'db-query-override', 'divergent-AAAA', 'candidate-database', 'candidate-webhook', 'runtime-schema', 'root-user', 'privileged', 'cap-add', 'security-override', 'writable-module-tmpfs', 'host-pid', 'config-mount', 'secret-mount', 'inherited-mount', 'hosts-override', 'dns-override', 'lifecycle-hook', 'mislabeled-nearer-dependency', 'readonly-worker-code', 'post-pass-worker-disappearance', 'post-pass-privilege-loss', 'worker-privileged', 'worker-cap-add', 'worker-security-override']:
            with self.subTest(failure=failure):
                path = operator.ROOT / 'lifecycle-settled.json'
                if path.exists():
                    path.unlink()
                web = {'Config': {'Env': ['DATABASE_URL=postgres://insignia_runtime@database:5432/insignia_rewrite',
                    'APP_URL=' + operator.ORIGIN, 'SHOPIFY_CLIENT_ID=synthetic-client', 'SHOPIFY_CLIENT_SECRET=synthetic-secret',
                    'SHOPIFY_WEBHOOK_SECRET=' + ('wrong' if failure == 'secret' else 'synthetic-secret')]}}
                worker = {'Id': 'synthetic-worker', 'HostConfig': {'ReadonlyRootfs': failure != 'writable-code', 'Privileged': failure == 'worker-privileged',
                        'CapDrop': ['ALL'], 'CapAdd': ['SYS_ADMIN'] if failure == 'worker-cap-add' else [],
                        'SecurityOpt': ['no-new-privileges:false'] if failure == 'worker-security-override' else ['no-new-privileges:true']},
                    'Mounts': [], 'Config': {'Entrypoint': ['/opt/unreviewed-wrapper'] if failure == 'custom-launcher' else [], 'User': 'node', 'Cmd': ['node', '/srv/worker/main.js'],
                    'Env': ['DATABASE_URL=postgres://' + ('underprivileged_worker' if failure == 'role' else 'insignia_runtime') + '@database:5432/insignia_rewrite',
                        'SHOPIFY_CLIENT_ID=synthetic-client', 'SHOPIFY_CLIENT_SECRET=synthetic-secret',
                        'INSIGNIA_CREDENTIAL_KEY_ID=synthetic-key', 'INSIGNIA_CREDENTIAL_KEY_BASE64=synthetic-key-bytes']}}
                if failure == 'readonly-worker-code':
                    worker['Mounts'] = [{'RW': False, 'Destination': '/srv/worker', 'Type': 'bind'}]
                if failure == 'db-query-override':
                    web['Config']['Env'][0] += '?host=unrelated-database'
                    worker['Config']['Env'][0] += '?host=unrelated-database'
                def network(ip, identity='exact-backend'):
                    return {'NetworkSettings': {'Networks': {'backend': {'NetworkID': identity, 'IPAddress': ip, 'GlobalIPv6Address': 'fd00::' + ip.rsplit('.',1)[1], 'Aliases': ['database']}}}}
                web.update({'Id': 'synthetic-web', **network('10.0.0.3')})
                worker.update(network('10.0.0.4', 'other-backend' if failure == 'separate-network' else 'exact-backend'))
                database = {'Id': 'synthetic-database', **network('10.0.0.2')}
                operator.prestate = lambda: [web, database]
                inspector = b'function inspectWorkerFromStdin() {}'
                inventory = b'{"version":"synthetic-only"}'
                database_probe = b'async function qualifyRuntimeDatabase() {}'
                (operator.ROOT / 'runtime-database.mjs').write_bytes(database_probe)
                (operator.ROOT / 'worker-inventory.mjs').write_bytes(inspector)
                (operator.ROOT / 'worker-executable-inventory.json').write_bytes(inventory)
                (operator.ROOT / 'expected-inputs.json').write_text(json.dumps({
                    'workerInspectorSha256': operator.sha(inspector), 'workerInventorySha256': operator.sha(inventory),
                    'runtimeDatabaseSha256': operator.sha(database_probe)}))
                phase = {'changed': False}
                def boundary(args, stdin=None, **kwargs):
                    if 'config' in args:
                        environment = dict(value.split('=', 1) for value in web['Config']['Env'])
                        if failure == 'candidate-database':
                            environment['DATABASE_URL'] = 'postgres://insignia_runtime@another:5432/insignia_rewrite'
                        if failure == 'candidate-webhook':
                            environment['SHOPIFY_WEBHOOK_SECRET'] = 'different-secret'
                        additions = {
                            'config-mount': {'configs': [{'source': 'shadow', 'target': '/srv/insignia/dist/server/entry.mjs'}]},
                            'secret-mount': {'secrets': [{'source': 'shadow', 'target': '/srv/insignia/node_modules/pg/lib/index.js'}]},
                            'inherited-mount': {'volumes_from': ['container:shadow:ro']},
                            'hosts-override': {'extra_hosts': ['database:10.0.1.2']},
                            'dns-override': {'dns': ['10.0.1.3']},
                            'lifecycle-hook': {'post_start': [{'command': 'unreviewed-hook'}]},
                        }.get(failure, {})
                        return json.dumps({'services': {'web': {**additions, 'image': operator.OLD_IMAGE,
                            'environment': {**environment, 'APP_URL': operator.ORIGIN},
                            'labels': {'traefik.enable': 'true',
                                'traefik.http.routers.insignia-canonical-m5-019r.rule': 'Host(`insignia-app.optidigi.nl`)'},
                            'read_only': True, 'networks': {'backend': {}}, 'volumes': [],
                            'user': '0' if failure == 'root-user' else 'node',
                            'privileged': failure == 'privileged',
                            'cap_drop': ['ALL'], 'cap_add': ['SYS_ADMIN'] if failure == 'cap-add' else [],
                            'security_opt': ['no-new-privileges:false'] if failure == 'security-override' else ['no-new-privileges:true'],
                            'tmpfs': ['/srv/insignia'] if failure == 'writable-module-tmpfs' else ['/tmp:size=64m,mode=1777'],
                            'pid': 'host' if failure == 'host-pid' else None}},
                            'networks': {'backend': {'name': 'backend'}}}).encode()
                    if args[:3] == ['docker', 'ps', '-q']:
                        return b'' if phase['changed'] and failure == 'post-pass-worker-disappearance' else b'synthetic-worker'
                    if args[:2] == ['docker', 'inspect']:
                        return json.dumps([worker]).encode()
                    if 'sha256sum' in args:
                        return ((('0' if failure == 'artifact' else '1') * 64) + '  main.js\n' + '2' * 64 + '  handlers.js\n').encode()
                    if '-e' in args:
                        if 'qualifyRuntimeDatabase' in args[args.index('-e') + 1]:
                            return json.dumps({'qualified': failure != 'runtime-schema'}).encode()
                        if 'dns.lookup' in args[args.index('-e') + 1]:
                            if failure == 'dns-drift' and 'synthetic-worker' in args:
                                return b'["10.0.1.2"]'
                            if 'family:4' in args[args.index('-e') + 1]:
                                return b'["10.0.0.2"]'
                            return b'["10.0.0.2","fd00::999"]' if failure == 'divergent-AAAA' else b'["10.0.0.2","fd00::2"]'
                        if 'inspectWorkerFromStdin' in args[args.index('-e') + 1]:
                            return json.dumps({'exact': failure not in ['artifact', 'dependency', 'mislabeled-nearer-dependency']}).encode()
                        return json.dumps({'status': 503 if failure == 'health' else 200, 'body': {'durableReady': True}}).encode()
                    if 'psql' in args:
                        result = {'queueSchemaPresent': True, 'queueRuntimeUsable': failure != 'queue'}
                        if b'uninstallRuntimeUsable' in stdin:
                            result['uninstallRuntimeUsable'] = failure != 'application-rights' and not (phase['changed'] and failure == 'post-pass-privilege-loss')
                        return json.dumps(result).encode()
                    raise AssertionError('Unexpected external command')
                operator.run = boundary
                operator.lifecycle()
                value = json.loads(path.read_text())
                self.assertEqual(value['classification'], 'PASS_UNINSTALL_PROCESSOR' if failure is None or failure.startswith('post-pass-') else 'BLOCKED_UNINSTALL_PROCESSOR_READINESS')
                self.assertEqual(value['databaseWrites'], 0)
                self.assertFalse(list(operator.ROOT.glob('*-reserved.json')))
                self.assertNotIn('synthetic-secret', json.dumps(value))
                if failure and failure.startswith('post-pass-'):
                    phase['changed'] = True
                    for action in [operator.require_lifecycle, operator.backup, operator.provision, operator.deploy, operator.restart, operator.append, lambda: operator.compose_web(operator.OLD_IMAGE)]:
                        with self.assertRaisesRegex(RuntimeError, 'Current uninstall processor readiness unqualified'):
                            action()
                        self.assertFalse(list(operator.ROOT.glob('*-reserved.json')))



if __name__ == '__main__':
    unittest.main()
