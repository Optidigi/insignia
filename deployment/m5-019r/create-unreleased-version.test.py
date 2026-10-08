"""Offline controls for the actual pre-dispatch validators; no Shopify transport."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

FILE = Path(__file__).with_name('create-unreleased-version.py')
spec = importlib.util.spec_from_file_location('m5_019_create', FILE)
operator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)
SOURCE = Path(__file__).resolve().parents[2]


def package_fixture(directory):
    candidate = Path(directory) / 'app-version-qualified'
    subprocess.run(['python3', '-B', str(SOURCE / 'deployment/m5-019r/package-app-version.py'),
                    str(SOURCE), str(candidate)], check=True, capture_output=True, text=True)
    return candidate


class GateControls(unittest.TestCase):
    def test_owner_revised_dedicated_origin_is_accepted(self):
        import tomllib
        with tempfile.TemporaryDirectory() as directory, patch.object(operator, 'NEUTRAL', Path(directory)):
            candidate = package_fixture(directory)
            app = tomllib.loads((candidate / 'shopify.app.m5-019r.toml').read_text())
            self.assertEqual(app['application_url'], 'https://insignia-app.optidigi.nl/admin/products')
            self.assertEqual(len(operator.validate_candidate(SOURCE, candidate)), 7)

    def test_canonical_origin_is_required_even_when_source_and_candidate_agree(self):
        for wrong in ['https://insignia.optidigi.com/admin/products',
                      'https://insignia.optidigi.nl/admin/products']:
            with self.subTest(wrong=wrong), tempfile.TemporaryDirectory() as directory, patch.object(operator, 'NEUTRAL', Path(directory)):
                candidate = package_fixture(directory)
                source = Path(directory) / 'source'
                shutil.copytree(SOURCE / 'deployment/m5-019r', source / 'deployment/m5-019r')
                for app in [candidate / 'shopify.app.m5-019r.toml', source / 'deployment/m5-019r/shopify.app.m5-019r.toml']:
                    app.write_text(app.read_text().replace('https://insignia-app.optidigi.nl/admin/products', wrong))
                with self.assertRaisesRegex(ValueError, 'canonical_app_url'):
                    operator.validate_candidate(source, candidate)

    def test_host_readiness_is_bound_to_owner_revised_origin(self):
        host = {'classification': 'CANONICAL_HOST_READINESS_PASS',
                'canonicalOrigin': 'https://insignia-app.optidigi.nl',
                'applicationUrl': 'https://insignia-app.optidigi.nl/admin/products',
                'runtimeAppUrl': 'https://insignia-app.optidigi.nl'}
        with patch.object(operator.subprocess, 'Popen') as transport:
            operator.validate_host(host)
            for origin in ['https://insignia.optidigi.com', 'https://insignia.optidigi.nl']:
                for field in ['canonicalOrigin', 'applicationUrl', 'runtimeAppUrl']:
                    changed = copy.deepcopy(host)
                    changed[field] = origin + ('/admin/products' if field == 'applicationUrl' else '')
                    with self.subTest(origin=origin, field=field), self.assertRaises(ValueError):
                        operator.validate_host(changed)
            changed = copy.deepcopy(host); changed['classification'] = 'PRIVATE_STAGE_PASS'
            with self.assertRaises(ValueError):
                operator.validate_host(changed)
            transport.assert_not_called()

    def test_superseded_version_must_stay_inactive_and_active_must_stay_exact(self):
        versions = [
            {'versionId': 'gid://shopify/Version/1153019904001', 'status': 'active', 'versionTag': 'insignia-3'},
            {'versionId': 'gid://shopify/Version/1158837927937', 'status': 'inactive', 'versionTag': 'm5-019-a9717e1265ef'},
            {'versionId': 'gid://shopify/Version/1152880803841', 'status': 'inactive', 'versionTag': 'insignia-2'},
            {'versionId': 'gid://shopify/Version/1146748534785', 'status': 'inactive', 'versionTag': 'insignia-1'},
        ]
        operator.validate_versions(versions)
        for index, field, value in [(1, 'status', 'active'), (0, 'status', 'inactive'), (1, 'versionTag', 'unexpected')]:
            changed = copy.deepcopy(versions);changed[index][field] = value
            with self.subTest(index=index, field=field), self.assertRaises(ValueError):
                operator.validate_versions(changed)
        with self.assertRaises(ValueError):
            operator.validate_versions(versions + [versions[1]])

    def test_optimized_python_still_rejects_unfrozen_gate(self):
        with tempfile.TemporaryDirectory() as directory:
            gate = Path(directory) / 'gate.json'
            gate.write_text(json.dumps({'slice': 'M5-019R', 'frozen': False}))
            environment = {key: os.environ[key] for key in ['HOME', 'PATH', 'LANG'] if key in os.environ}
            environment['PYTHONOPTIMIZE'] = '1'
            reservation = operator.CANONICAL / 'creation-reservation.json'
            before = reservation.read_bytes() if reservation.exists() else None
            result = subprocess.run(['python3', '-O', '-B', str(FILE), str(gate)],
                                    env=environment, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('gate_not_frozen', result.stderr)
            self.assertEqual(reservation.read_bytes() if reservation.exists() else None, before)

    def test_cli_home_bound_and_ambient_loader_path_stripped(self):
        for home in [None, '/different-account']:
            with self.subTest(home=home), patch.dict(os.environ, {}, clear=True):
                if home is not None:
                    os.environ['HOME'] = home
                with self.assertRaisesRegex(ValueError, 'cli_home_binding'):
                    operator.cli_environment()
                with tempfile.TemporaryDirectory() as directory:
                    gate = Path(directory) / 'gate.json'
                    gate.write_text(json.dumps({'slice': 'M5-019R', 'frozen': True}))
                    reservation = operator.CANONICAL / 'creation-reservation.json'
                    before = reservation.read_bytes() if reservation.exists() else None
                    result = subprocess.run([sys.executable, '-B', str(FILE), str(gate)],
                                            capture_output=True, text=True)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('cli_home_binding', result.stderr)
                    self.assertEqual(reservation.read_bytes() if reservation.exists() else None, before)
        with patch.dict(os.environ, {'HOME': '/home/serveradmin', 'PATH': '/unreviewed',
                                    'NODE_OPTIONS': '--require=/synthetic/escape-denied.js',
                                    'SHOPIFY_FLAG_FORCE': 'synthetic-denied'}):
            environment = operator.cli_environment()
            self.assertEqual(environment['HOME'], '/home/serveradmin')
            self.assertEqual(environment['PATH'], operator.CLI_PATH)
            self.assertNotIn('NODE_OPTIONS', environment)
            self.assertNotIn('SHOPIFY_FLAG_FORCE', environment)

    def test_review_reports_and_settings_must_be_distinct(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(operator, 'NEUTRAL', Path(directory)):
            reviews = [{'report': str(Path(directory) / 'spec.md'), 'settings': str(Path(directory) / 'spec.json')},
                       {'report': str(Path(directory) / 'security.md'), 'settings': str(Path(directory) / 'security.json')}]
            operator.validate_review_paths(reviews)
            for field in ['report', 'settings']:
                changed = copy.deepcopy(reviews)
                changed[1][field] = changed[0][field]
                with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'review_file_duplicate'):
                    operator.validate_review_paths(changed)

    def test_git_uses_trusted_executable_and_ignores_substituted_context(self):
        with patch.dict(os.environ, {'PATH': '/synthetic/unreviewed',
                                    'GIT_DIR': '/synthetic/substituted', 'GIT_WORK_TREE': '/synthetic/substituted',
                                    'GIT_CONFIG_GLOBAL': '/synthetic/unreviewed-config'}):
            with patch.object(operator.subprocess, 'check_output', return_value=b'context') as execute:
                self.assertEqual(operator.git_output(SOURCE, 'rev-parse', 'HEAD'), b'context')
                arguments = execute.call_args.args[0]
                environment = execute.call_args.kwargs['env']
                self.assertEqual(arguments[0], '/usr/bin/git')
                self.assertIn('core.fsmonitor=false', arguments)
                self.assertIn('core.hooksPath=/dev/null', arguments)
                self.assertNotIn('GIT_DIR', environment)
                self.assertNotIn('GIT_WORK_TREE', environment)
                self.assertEqual(environment['GIT_CONFIG_GLOBAL'], '/dev/null')
                self.assertEqual(environment['GIT_CONFIG_NOSYSTEM'], '1')
            self.assertEqual(operator.git_output(SOURCE, 'rev-parse', '--show-toplevel').decode().strip(), str(SOURCE))

    def test_ten_duplicate_workflows_are_rejected(self):
        rows = [{'name': next(iter(operator.WORKFLOWS)), 'databaseId': 1}] * 10
        with self.assertRaisesRegex(ValueError, 'ci_workflow_set'):
            operator.validate_ci(rows, 'head')

    def test_exact_ci_identity_head_and_attempt(self):
        rows = [{'name': name, 'databaseId': index, 'headSha': 'head', 'attempt': 1,
                 'status': 'completed', 'conclusion': 'success',
                 'url': 'https://github.com/Optidigi/insignia/actions/runs/' + str(index)}
                for index, name in enumerate(sorted(operator.WORKFLOWS), 1)]
        operator.validate_ci(rows, 'head')
        for key, value in [('databaseId', 2), ('headSha', 'stale'), ('attempt', 2),
                           ('conclusion', 'failure'), ('status', 'in_progress'),
                           ('url', 'https://github.com/unrelated/repo/actions/runs/1')]:
            changed = copy.deepcopy(rows)
            changed[0][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                operator.validate_ci(changed, 'head')

    def test_complete_unique_inventory_required(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'required'
            path.write_bytes(b'bound')
            row = {'path': str(path), 'sha256': operator.digest(path)}
            operator.validate_files([row], {path.resolve()})
            for rows in [[], [row, row], [row, {'path': str(path.with_name('extra')), 'sha256': 'none'}]]:
                with self.subTest(rows=len(rows)), self.assertRaises(ValueError):
                    operator.validate_files(rows, {path.resolve()})
            path.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'frozen_file_changed'):
                operator.validate_files([row], {path.resolve()})

    def test_candidate_wasm_query_config_extras_and_escape_rejected(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(operator, 'NEUTRAL', Path(directory)):
            candidate = package_fixture(directory)
            self.assertEqual(len(operator.validate_candidate(SOURCE, candidate)), 7)
            for relative in ['extensions/insignia-cart-transform/target/cart-transform.wasm',
                             'extensions/insignia-cart-validation/src/cart_validations_generate_run.graphql',
                             'extensions/insignia-cart-transform/shopify.extension.toml']:
                path = candidate / relative
                original = path.read_bytes()
                path.write_bytes(original + b'changed')
                with self.subTest(file=relative), self.assertRaises(ValueError):
                    operator.validate_candidate(SOURCE, candidate)
                path.write_bytes(original)
            extra = candidate / 'unexpected-theme.txt'
            extra.write_text('outside reviewed payload')
            with self.assertRaisesRegex(ValueError, 'candidate_file_set_changed'):
                operator.validate_candidate(SOURCE, candidate)
            extra.unlink()
            extra.symlink_to(FILE)
            with self.assertRaisesRegex(ValueError, 'candidate_path_escape'):
                operator.validate_candidate(SOURCE, candidate)

    def test_mandatory_inventory_includes_actual_baseline_and_modules(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(operator, 'NEUTRAL', Path(directory)):
            candidate = package_fixture(directory)
            modules = operator.validate_candidate(SOURCE, candidate)
            required = operator.mandatory_files(SOURCE, modules, [])
            baseline = json.loads((SOURCE / 'docs/delivery/evidence/m5-018/freeze-round4-inventory.json').read_text())
            self.assertTrue({(SOURCE / row['path']).resolve() for row in baseline['source'] + baseline['build']} <= required)
            self.assertTrue(modules <= required)
            self.assertIn(operator.NODE.resolve(), required)
            self.assertIn(operator.CLI.resolve(), required)
            with self.assertRaisesRegex(ValueError, 'frozen_inventory_incomplete'):
                operator.validate_files([], required)

    def test_tracked_directory_symlink_and_full_inventory_round_trip(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(operator, 'NEUTRAL', Path(directory)):
            candidate = package_fixture(directory)
            modules = operator.validate_candidate(SOURCE, candidate)
            for name in ['preversion-ci.json', 'versions-pre-freeze.json', 'reservation-control.json']:
                (Path(directory) / name).write_text('{}')
            required = operator.mandatory_files(SOURCE, modules, [])
            link = SOURCE / 'spikes/m0-013/rust/extensions/transform'
            self.assertTrue(link.is_symlink())
            self.assertIn(link, required)
            rows = [{'path': str(path), 'kind': 'symlink' if path.is_symlink() else 'file',
                     'sha256': operator.digest(path)} for path in sorted(required)]
            operator.validate_files(rows, required)
            link_row = next(row for row in rows if row['path'] == str(link))
            changed = copy.deepcopy(rows)
            next(row for row in changed if row['path'] == str(link))['kind'] = 'file'
            with self.assertRaisesRegex(ValueError, 'frozen_file_kind_changed'):
                operator.validate_files(changed, required)
            self.assertEqual(link_row['sha256'], operator.digest(link))

    def test_new_accounting_parent_sync_precedes_reservation_and_dispatch(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(operator, 'CANONICAL', Path(directory) / 'new-run'):
            events = []
            real_open, real_fsync = os.open, os.fsync
            descriptors = {}
            def opened(path, flags, *args):
                fd = real_open(path, flags, *args)
                descriptors[fd] = str(path)
                return fd
            def synced(fd):
                events.append(descriptors.get(fd))
                real_fsync(fd)
            with patch.object(operator.os, 'open', side_effect=opened), patch.object(operator.os, 'fsync', side_effect=synced):
                operator.establish_accounting_directory()
                operator.durable_new(operator.CANONICAL / 'creation-reservation.json', {'attempt': 1})
            self.assertEqual(events[:3], [directory, str(operator.CANONICAL / 'creation-reservation.json'), str(operator.CANONICAL)])
            with patch.object(operator.os, 'fsync', side_effect=OSError('sync-denied')):
                with self.assertRaisesRegex(OSError, 'sync-denied'):
                    operator.establish_accounting_directory()

    def test_durable_claim_survives_duplicate(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'reservation.json'
            operator.durable_new(path, {'attempt': 1})
            original = path.read_bytes()
            with self.assertRaises(FileExistsError):
                operator.durable_new(path, {'attempt': 2})
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)


if __name__ == '__main__':
    unittest.main()
