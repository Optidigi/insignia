"""Offline controls for the actual pre-dispatch validators; no Shopify transport."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
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
    subprocess.run(['python3', '-B', str(SOURCE / 'deployment/m5-019/package-app-version.py'),
                    str(SOURCE), str(candidate)], check=True, capture_output=True, text=True)
    return candidate


class GateControls(unittest.TestCase):
    def test_optimized_python_still_rejects_unfrozen_gate(self):
        with tempfile.TemporaryDirectory() as directory:
            gate = Path(directory) / 'gate.json'
            gate.write_text(json.dumps({'slice': 'M5-019', 'frozen': False}))
            environment = {key: os.environ[key] for key in ['HOME', 'PATH', 'LANG'] if key in os.environ}
            environment['PYTHONOPTIMIZE'] = '1'
            reservation = operator.CANONICAL / 'creation-reservation.json'
            before = reservation.read_bytes() if reservation.exists() else None
            result = subprocess.run(['python3', '-O', '-B', str(FILE), str(gate)],
                                    env=environment, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('gate_not_frozen', result.stderr)
            self.assertEqual(reservation.read_bytes() if reservation.exists() else None, before)

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
