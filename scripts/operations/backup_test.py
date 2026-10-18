import os
from unittest.mock import patch
import importlib.util
import pathlib
import tempfile
import unittest

MODULE = pathlib.Path(__file__).with_name('backup.py')

class RecoveryContract(unittest.TestCase):
    def test_archive_rejects_missing_original_and_path_escape(self):
        spec = importlib.util.spec_from_file_location('backup', MODULE)
        backup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(backup)
        with tempfile.TemporaryDirectory(dir='/dev/shm') as directory:
            root = pathlib.Path(directory)
            for key in ['missing-original', '../outside']:
                with self.assertRaises(ValueError):
                    backup.validate_objects(root, [{'key': key, 'sha256': 'a'*64, 'expiresAt': '2099-01-01T00:00:00+00:00'}])


@patch.dict(os.environ,{name:'' for name in ['PGSERVICE','PGSERVICEFILE','PGHOSTADDR','PGOPTIONS','DATABASE_URL']})
class EncryptedSnapshot(unittest.TestCase):
    def test_real_encryption_restores_bytes_and_deadline_retention_preserves_unowned_files(self):
        import datetime as dt
        import hashlib
        import json
        import os
        import subprocess
        import tarfile
        from types import SimpleNamespace
        spec = importlib.util.spec_from_file_location('backup', MODULE)
        backup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(backup)
        with tempfile.TemporaryDirectory(dir='/dev/shm') as directory:
            root = pathlib.Path(directory)
            objects = root / 'objects'
            objects.mkdir(mode=0o700)
            original = objects / 'original.png'
            original.write_bytes(b'original exact bytes\x00\xff')
            deadline = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=2)
            manifest = root / 'manifest.json'
            manifest.write_text(json.dumps({'format': 'insignia-offline-object-snapshot-v1',
                'quiesced': True, 'absoluteExpiresAt': (deadline+dt.timedelta(days=180)).isoformat(), 'promisedCleanupAt': None, 'quiescence': {'id': 'test-window', 'startedAt': (dt.datetime.now(dt.timezone.utc)-dt.timedelta(seconds=1)).isoformat(), 'until': deadline.isoformat()}, 'databaseExpiresAt': (deadline + dt.timedelta(hours=1)).isoformat(), 'capturedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                'objects': [{'key': 'original.png', 'sha256': hashlib.sha256(original.read_bytes()).hexdigest(),
                'expiresAt': deadline.isoformat()}]}))
            # Only the PostgreSQL process boundary is substituted in this local archive test.
            dumper = root / 'pg_dump'
            dumper.write_text('#!/usr/bin/env python3\nimport sys,pathlib\npathlib.Path(sys.argv[-1]).write_bytes(b"purchase records fixture")\n')
            dumper.chmod(0o700)
            key, certificate = root / 'key.pem', root / 'recipient.pem'
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                '-subj', '/CN=local-recovery-test', '-keyout', str(key), '-out', str(certificate)],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            store = root / 'store'
            arguments=SimpleNamespace(store=str(store), objects=str(objects), object_manifest=str(manifest), scratch=str(root/'scratch'), pg_dump=str(dumper), recipient=str(certificate))
            result = backup.backup(arguments)
            self.assertEqual(backup.timestamp(result['expiresAt'])-backup.timestamp(result['createdAt']),dt.timedelta(days=7))
            self.assertLess(deadline,backup.timestamp(result['expiresAt']))
            artifact = store / (result['id'] + '.cms')
            self.assertNotIn(b'original exact bytes', artifact.read_bytes())
            recovered = root / 'recovered.tar'
            subprocess.run(['openssl', 'cms', '-decrypt', '-binary', '-inform', 'DER', '-in', str(artifact),
                '-inkey', str(key), '-out', str(recovered)], check=True, capture_output=True)
            with tarfile.open(recovered) as archive:
                self.assertEqual(archive.extractfile('objects/original.png').read(), b'original exact bytes\x00\xff')
                self.assertEqual(archive.extractfile('database.dump').read(), b'purchase records fixture')
                archived_manifest=json.load(archive.extractfile('objects.json'))
                self.assertEqual(archived_manifest['objects'][0]['expiresAt'],deadline.isoformat())
            original_receipt=(store/(result['id']+'.json')).read_bytes()
            policy=json.loads(manifest.read_text())
            absolute=deadline+dt.timedelta(hours=16)
            promised=deadline+dt.timedelta(hours=10)
            policy.update(absoluteExpiresAt=absolute.isoformat(),promisedCleanupAt=promised.isoformat())
            manifest.write_text(json.dumps(policy))
            promised_result=backup.backup(arguments)
            self.assertEqual(backup.timestamp(promised_result['expiresAt']),promised)
            policy['promisedCleanupAt']=None;manifest.write_text(json.dumps(policy))
            absolute_result=backup.backup(arguments)
            self.assertEqual(backup.timestamp(absolute_result['expiresAt']),absolute)
            self.assertEqual((store/(result['id']+'.json')).read_bytes(),original_receipt)
            unrelated = store / 'do-not-delete.cms'
            unrelated.write_bytes(b'unowned')
            backup.prune(store, backup.timestamp(result['expiresAt']) + dt.timedelta(seconds=1))
            self.assertFalse(artifact.exists())
            self.assertTrue(unrelated.exists())
            self.assertEqual(original.read_bytes(), b'original exact bytes\x00\xff')

    def test_restore_rejects_network_or_existing_runtime_database_before_any_effect(self):
        import os
        from unittest.mock import patch
        from types import SimpleNamespace
        spec = importlib.util.spec_from_file_location('backup', MODULE)
        backup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(backup)
        with patch.dict(os.environ, {'PGHOST': 'production.example', 'PGDATABASE': 'production'}):
            with self.assertRaises(ValueError):
                backup.restore(SimpleNamespace())

    def test_restore_rejects_tcp_override_even_when_socket_and_recovery_name_are_explicit(self):
        import os
        from unittest.mock import patch
        from types import SimpleNamespace
        spec = importlib.util.spec_from_file_location('backup', MODULE)
        backup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(backup)
        with patch.dict(os.environ, {'PGHOST': '/private/owned/socket', 'PGDATABASE': 'insignia_recovery_test', 'PGHOSTADDR': '127.0.0.1'}):
            with self.assertRaisesRegex(ValueError, 'ambient database authority'):
                backup.restore(SimpleNamespace())

    def test_damaged_intent_does_not_block_other_expired_partial_archive_deletion(self):
        import datetime as dt
        import json
        spec = importlib.util.spec_from_file_location('backup', MODULE)
        backup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(backup)
        with tempfile.TemporaryDirectory() as directory:
            store = pathlib.Path(directory)
            broken = store/'11111111-1111-1111-1111-111111111111.intent.json'
            broken.write_text('{')
            identity = '22222222-2222-2222-2222-222222222222'
            (store/(identity+'.intent.json')).write_text(json.dumps({'format':'insignia-backup-intent-v1','id':identity,'expiresAt':'2000-01-01T00:00:00+00:00'}))
            artifact = store/(identity+'.cms')
            artifact.write_bytes(b'interrupted ciphertext')
            with self.assertRaises(ValueError):
                backup.prune(store,dt.datetime.now(dt.timezone.utc))
            self.assertFalse(artifact.exists())
            self.assertTrue(broken.exists())

    def test_source_alternate_libpq_authority_rejected_before_store_or_dump_access(self):
        import os
        from unittest.mock import patch
        from types import SimpleNamespace
        spec=importlib.util.spec_from_file_location('backup',MODULE)
        backup=importlib.util.module_from_spec(spec);spec.loader.exec_module(backup)
        for name in ['PGSERVICE','PGSERVICEFILE','PGHOSTADDR','PGOPTIONS','DATABASE_URL']:
            with self.subTest(name=name),patch.dict(os.environ,{name:'forbidden'}):
                with self.assertRaisesRegex(ValueError,'alternate source database authority'):
                    backup.backup(SimpleNamespace())

    def test_expired_or_erased_staged_original_is_physically_removed_without_restamping_live_history(self):
        import datetime as dt
        spec=importlib.util.spec_from_file_location('backup',MODULE)
        backup=importlib.util.module_from_spec(spec);spec.loader.exec_module(backup)
        with tempfile.TemporaryDirectory() as directory:
            stage=pathlib.Path(directory);(stage/'objects').mkdir()
            for name in ['expired','erased','retained']:(stage/'objects'/name).write_bytes(b'original')
            manifest={'objects':[{'key':'expired','expiresAt':'2000-01-01T00:00:00+00:00'},{'key':'erased','expiresAt':'2099-01-01T00:00:00+00:00'},{'key':'retained','expiresAt':'2099-01-01T00:00:00+00:00'}]}
            removed=backup.remove_staged_exclusions(stage,manifest,{'erased'},dt.datetime.now(dt.timezone.utc))
            self.assertEqual(removed,2)
            self.assertFalse((stage/'objects/expired').exists());self.assertFalse((stage/'objects/erased').exists())
            self.assertEqual((stage/'objects/retained').read_bytes(),b'original')
            self.assertEqual(manifest['objects'][0]['expiresAt'],'2000-01-01T00:00:00+00:00')

if __name__ == '__main__':
    unittest.main()
