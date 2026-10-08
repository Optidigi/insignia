"""Offline public-seam controls for the one-shot existing-version release."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

MODULE = Path(__file__).with_name('release-existing.py')
spec = importlib.util.spec_from_file_location('release_existing', MODULE)
op = importlib.util.module_from_spec(spec)
spec.loader.exec_module(op)


class ReleaseControls(unittest.TestCase):
    def test_prestate_rejects_new_active_or_candidate(self):
        rows = op.expected_versions()
        op.validate_versions(rows)
        for drift in [rows + [{'versionId': 'gid://shopify/Version/999', 'status': 'inactive', 'versionTag': 'extra'}],
                      [{**r, 'status': 'active'} if r['versionId'].endswith('1158986629121') else r for r in rows]]:
            with self.assertRaises(ValueError):
                op.validate_versions(drift)

    def test_missing_gate_never_dispatches(self):
        with patch.object(op.subprocess, 'Popen') as spawn:
            with self.assertRaises((ValueError, FileNotFoundError)):
                op.release_existing(Path('/tmp/not-an-authorized-gate.json'))
            spawn.assert_not_called()

    def test_partial_gate_is_rejected_without_dispatch(self):
        with patch.object(op.subprocess, "Popen") as spawn:
            with self.assertRaises(ValueError):
                op.validate_gate_data({"frozen": True})
            spawn.assert_not_called()

    def test_environment_drops_token_proxy_loader_and_force_overrides(self):
        with patch.dict(op.os.environ, {'HOME': '/home/serveradmin', 'NODE_OPTIONS': '--require bad',
                                      'SHOPIFY_FLAG_FORCE': '1', 'HTTPS_PROXY': 'synthetic',
                                      'SHOPIFY_CLI_PARTNERS_TOKEN': 'synthetic'}, clear=False):
            env = op.environment()
            for key in ['NODE_OPTIONS', 'SHOPIFY_FLAG_FORCE', 'HTTPS_PROXY', 'SHOPIFY_CLI_PARTNERS_TOKEN']:
                self.assertNotIn(key, env)
        with patch.dict(op.os.environ, {'HOME': '/tmp/wrong'}):
            with self.assertRaises(ValueError):
                op.environment()

    def invoke(self, output, exit_code=0, timeout=False):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        gate = root / 'gate.json'
        gate.write_text('{}')
        run = root / 'run'
        observed = []

        class Process:
            pid = 12345
            def wait(self, timeout=None):
                if timeout is not None and timeout > 5 and self_timeout:
                    raise subprocess.TimeoutExpired('local fake CLI', timeout)
                return exit_code
        self_timeout = timeout
        def spawn(arguments, **kwargs):
            reservation = json.loads((run / 'release-reservation.json').read_text())
            self.assertEqual(reservation['attempt'], 1)
            self.assertEqual(reservation['versionCreationAttempts'], 0)
            self.assertEqual(reservation['versionId'], '1158986629121')
            self.assertEqual((run.stat().st_mode & 0o777), 0o700)
            observed.append(arguments)
            kwargs['stdout'].write(output)
            kwargs['stdout'].flush()
            return Process()
        with patch.object(op, 'RUN', run), patch.object(op, 'validate_gate', return_value={'sourceHead': 'synthetic-head'}), \
             patch.object(op.subprocess, 'Popen', side_effect=spawn), patch.object(op.os, 'killpg'):
            result = op.release_existing(gate)
            with self.assertRaises(FileExistsError):
                op.release_existing(gate)
        self.assertEqual(len(observed), 1)
        arguments = observed[0]
        self.assertIn('release', arguments)
        self.assertIn('--allow-updates', arguments)
        self.assertNotIn('--allow-deletes', arguments)
        self.assertNotIn('deploy', arguments)
        self.assertNotIn('build', arguments)
        self.assertEqual(arguments[arguments.index('--version') + 1], 'm5-019r-9b94149272d1')
        return result

    def test_ack_requires_exact_supported_success_message(self):
        self.assertEqual(self.invoke('Version released to users. m5-019r-9b94149272d1')['outcome'],
                         'CLI_ACK_READBACK_REQUIRED')

    def test_exit_zero_user_error_is_not_ack_and_cannot_retry(self):
        self.assertEqual(self.invoke("Version couldn't be released.")['outcome'], 'AMBIGUOUS_STOP_NO_RETRY')

    def test_timeout_consumes_attempt_and_cannot_retry(self):
        self.assertEqual(self.invoke('', timeout=True)['outcome'], 'AMBIGUOUS_STOP_NO_RETRY')

    def test_nonzero_exit_consumes_attempt(self):
        self.assertEqual(self.invoke('failed', exit_code=1)['outcome'], 'AMBIGUOUS_STOP_NO_RETRY')


if __name__ == '__main__':
    unittest.main()
