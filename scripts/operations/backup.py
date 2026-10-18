#!/usr/bin/env python3
"""Private local backup/recovery operator. Never enables a restored service."""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import uuid

UTC = dt.timezone.utc
HOLD = 'HOLD_STORAGE_ERASURE_AND_AUTHORITY_REQUALIFICATION'


def timestamp(value):
    result = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('timezone required')
    return result


def digest(path):
    with open(path, 'rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def private_directory(path):
    path = Path(path)
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    stat = path.lstat()
    if path.is_symlink() or not path.is_dir() or stat.st_uid != os.getuid() or stat.st_mode & 0o077:
        raise ValueError('private owned directory required')
    return path


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def receipt(path, value):
    temporary = path.parent / ('.receipt-' + str(uuid.uuid4()) + '.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'w') as output:
            json.dump(value, output, sort_keys=True)
            output.flush()
            os.fsync(output.fileno())
        os.link(temporary, path, follow_symlinks=False)  # atomic publish, never replace
        sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)
        sync_directory(path.parent)


def run(argv, **kwargs):
    # Tool failures can contain credentials, SQL, object names or PII. Never echo them.
    subprocess.run(argv, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **kwargs)


def validate_objects(root, objects, allow_expired=False):
    seen = set()
    for obj in objects:
        key = obj['key']
        candidate = root / key
        if (not isinstance(key, str) or not key or key.startswith('/') or
                any(part in ('', '.', '..') for part in key.split('/')) or key in seen):
            raise ValueError('invalid object identity')
        seen.add(key)
        if any(part.is_symlink() for part in [candidate, *candidate.parents]) or not candidate.is_file():
            raise ValueError('missing or unsafe object')
        if not re.fullmatch('[a-f0-9]{64}', obj['sha256']) or digest(candidate) != obj['sha256']:
            raise ValueError('object hash mismatch')
        if not allow_expired and timestamp(obj['expiresAt']) <= dt.datetime.now(UTC):
            raise ValueError('expired object')


def require_tmpfs(path):
    if subprocess.check_output(['stat', '-f', '-c', '%T', str(path)], stderr=subprocess.DEVNULL).strip() != b'tmpfs':
        raise ValueError('ephemeral tmpfs required')


def check_window(manifest):
    window = manifest['quiescence']
    now = dt.datetime.now(UTC)
    if not window['id'] or timestamp(window['startedAt']) > timestamp(manifest['capturedAt']) or timestamp(window['until']) <= now:
        raise ValueError('snapshot exclusion window expired')


def source_environment():
    if any(os.environ.get(name) for name in ['PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR', 'PGOPTIONS', 'DATABASE_URL']):
        raise ValueError('alternate source database authority forbidden')
    if ',' in os.environ.get('PGHOST', '') or ',' in os.environ.get('PGPORT', '') or any(value in os.environ.get('PGDATABASE', '') for value in ['://', '=']):
        raise ValueError('alternate source database authority forbidden')


def backup(args):
    source_environment()
    store = private_directory(args.store)
    with open(store / '.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        manifest = json.loads(Path(args.object_manifest).read_text())
        if manifest.get('format') != 'insignia-offline-object-snapshot-v1' or manifest.get('quiesced') is not True:
            raise ValueError('qualified quiesced object snapshot required')
        # Manifest provenance/completeness is an operator prerequisite, not inferred from a checksum.
        check_window(manifest)
        objects = manifest['objects']
        root = private_directory(args.objects)
        require_tmpfs(root)
        validate_objects(root, objects)
        now = dt.datetime.now(UTC)
        if timestamp(manifest['capturedAt']) > now or now - timestamp(manifest['capturedAt']) > dt.timedelta(hours=1):
            raise ValueError('stale snapshot')
        database_deadline = timestamp(manifest['databaseExpiresAt'])
        if database_deadline <= now:
            raise ValueError('expired database payload retention')
        absolute = timestamp(manifest['absoluteExpiresAt'])
        if absolute <= now or 'promisedCleanupAt' not in manifest:
            raise ValueError('absolute retention and explicit cutoff policy required')
        expires = min(now + dt.timedelta(days=7), absolute)
        if manifest['promisedCleanupAt'] is not None:
            expires = min(expires, timestamp(manifest['promisedCleanupAt']))
        if expires <= now:
            raise ValueError('explicit cleanup cutoff reached')
        identity = str(uuid.uuid4())
        artifact = store / (identity + '.cms')
        receipt(store / (identity + '.intent.json'), {
            'format': 'insignia-backup-intent-v1', 'id': identity, 'expiresAt': expires.isoformat()})
        scratch = private_directory(args.scratch)
        require_tmpfs(scratch)
        with tempfile.TemporaryDirectory(prefix='.backup-', dir=scratch) as temporary:
            stage = Path(temporary)
            dump = stage / 'database.dump'
            run([args.pg_dump, '--format=custom', '--no-password', '--file', str(dump)])
            dump_sha256 = digest(dump)
            check_window(manifest)
            archive = stage / 'snapshot.tar'
            with tarfile.open(archive, 'w') as output:
                output.add(dump, arcname='database.dump')
                for obj in objects:
                    output.add(root / obj['key'], arcname='objects/' + obj['key'], recursive=False)
                snapshot = stage / 'objects.json'
                snapshot.write_text(json.dumps(manifest))
                output.add(snapshot, arcname='objects.json')
            validate_objects(root, objects)  # fail if a source changed while copied
            encrypted = stage / 'snapshot.cms'
            run(['openssl', 'cms', '-encrypt', '-binary', '-aes-256-gcm', '-outform', 'DER',
                 '-in', str(archive), '-out', str(encrypted), args.recipient])
            with encrypted.open('rb') as source:
                os.fsync(source.fileno())
            # Exclusive destination protects against overwrite; ciphertext is durable before receipt.
            fd = os.open(artifact, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'wb') as target, encrypted.open('rb') as source:
                import shutil
                shutil.copyfileobj(source, target)
                target.flush()
                os.fsync(target.fileno())
            sync_directory(store)
        check_window(manifest)
        completed = dt.datetime.now(UTC)
        if completed >= expires:
            raise ValueError('backup expired before completion')
        value = {'format': 'insignia-encrypted-backup-v1', 'id': identity,
                 'createdAt': now.isoformat(), 'completedAt': completed.isoformat(), 'expiresAt': expires.isoformat(),
                 'absoluteExpiresAt': manifest['absoluteExpiresAt'], 'promisedCleanupAt': manifest['promisedCleanupAt'],
                 'originalDatabaseExpiresAt': manifest['databaseExpiresAt'],
                 'dumpSha256': dump_sha256, 'quiescenceId': manifest['quiescence']['id'],
                 'sha256': digest(artifact), 'bytes': artifact.stat().st_size,
                 'objects': len(objects), 'readiness': 'BACKUP_CREATED_RESTORE_UNQUALIFIED'}
        receipt(store / (identity + '.json'), value)
        prune(store, dt.datetime.now(UTC))
        return value


def prune(store, now):
    """Prune independent owned expiries even when another receipt is malformed."""
    failures = 0
    for path in [*store.glob('*.intent.json'), *store.glob('*.json')]:
        is_intent = path.name.endswith('.intent.json')
        pattern = r'[a-f0-9-]{36}\.intent\.json' if is_intent else r'[a-f0-9-]{36}\.json'
        if not re.fullmatch(pattern, path.name) or not path.exists():
            continue
        try:
            if path.is_symlink():
                raise ValueError('unsafe retention sidecar')
            value = json.loads(path.read_text())
            suffix = '.intent.json' if is_intent else '.json'
            format_name = 'insignia-backup-intent-v1' if is_intent else 'insignia-encrypted-backup-v1'
            if value.get('format') != format_name or value.get('id') + suffix != path.name:
                raise ValueError('invalid retention ownership')
            if timestamp(value['expiresAt']) > now:
                continue
            for suffix in ['.cms', '.json']:
                owned = store / (value['id'] + suffix)
                if owned.is_symlink():
                    raise ValueError('unsafe retention artifact')
                if owned.exists():
                    owned.unlink()
            path.unlink(missing_ok=True)
            sync_directory(store)
        except Exception:
            failures += 1
    if failures:
        raise ValueError('retention completed with damaged identities requiring inspection')


def remove_staged_exclusions(stage, manifest, exclusions, now):
    removed = 0
    for obj in manifest['objects']:
        if obj['key'] in exclusions or timestamp(obj['expiresAt']) <= now:
            candidate = stage / 'objects' / obj['key']
            if candidate.is_symlink() or '..' in Path(obj['key']).parts or Path(obj['key']).is_absolute():
                raise ValueError('unsafe restored object identity')
            candidate.unlink()
            removed += 1
    return removed


def restore(args):
    # Only an explicitly selected new database on a private Unix socket. No public runtime action exists.
    if any(os.environ.get(name) for name in ['PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR', 'DATABASE_URL']):
        raise ValueError('ambient database authority is forbidden for restore')
    host = os.environ.get('PGHOST', '')
    database = os.environ.get('PGDATABASE', '')
    if not host.startswith('/') or ',' in host or not re.fullmatch('insignia_recovery_[a-z0-9_]{1,40}', database):
        raise ValueError('isolated recovery database and Unix socket required')
    if not Path(host).is_dir():
        raise ValueError('owned isolated socket directory required')
    private_directory(host)
    stage = private_directory(args.destination)
    require_tmpfs(stage)
    if list(stage.iterdir()):
        raise ValueError('empty recovery destination required')
    receipt(stage / 'HOLD.json', {'readiness': HOLD, 'startedAt': dt.datetime.now(UTC).isoformat()})
    completed = False
    try:
        value = restore_snapshot(args, stage, host, database)
        completed = True
        return value
    finally:
        # The seven-day exception covers ciphertext, never interrupted decrypted scratch.
        for name in ['snapshot.tar', 'database.dump', 'expiry-replay.json',
                     'restore-pre.sql', 'restore-data.sql', 'restore-post.sql', 'restore-fix.sql']:
            (stage / name).unlink(missing_ok=True)
        if not completed:
            if (stage / 'objects').exists():
                shutil.rmtree(stage / 'objects')
            (stage / 'objects.json').unlink(missing_ok=True)
            (stage / 'objects.sanitized.json').unlink(missing_ok=True)
        sync_directory(stage)


def restore_snapshot(args, stage, host, database):
    metadata = json.loads(Path(args.receipt).read_text())
    if (metadata.get('format') != 'insignia-encrypted-backup-v1' or
            not re.fullmatch('[a-f0-9-]{36}', metadata.get('id', '')) or
            Path(args.artifact).name != metadata['id'] + '.cms' or
            Path(args.receipt).name != metadata['id'] + '.json' or
            timestamp(metadata['expiresAt']) <= dt.datetime.now(UTC) or digest(args.artifact) != metadata['sha256']):
        raise ValueError('invalid or expired backup')
    exclusion_fd = os.open(args.exclusions, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(exclusion_fd, 'r') as exclusion_file:
        info = os.fstat(exclusion_file.fileno())
        if info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_size > 64*1024*1024:
            raise ValueError('private current exclusion export required')
        exclusion = json.load(exclusion_file)
    coverage = timestamp(exclusion['data']['exportedAt'])
    current = dt.datetime.now(UTC)
    if coverage < timestamp(metadata['completedAt']) or coverage > current or current-coverage > dt.timedelta(minutes=15):
        raise ValueError('fresh post-backup erasure coverage required')
    archive = stage / 'snapshot.tar'
    run(['openssl', 'cms', '-decrypt', '-binary', '-inform', 'DER', '-in', args.artifact,
         '-inkey', args.identity, '-out', str(archive)])
    with tarfile.open(archive) as source:
        names = set()
        for member in source.getmembers():
            if (not member.isfile() or member.name in names or member.name.startswith('/') or
                    any(part in ('', '.', '..') for part in member.name.split('/')) or
                    not (member.name in ('database.dump', 'objects.json') or member.name.startswith('objects/'))):
                raise ValueError('unsafe archive')
            names.add(member.name)
        source.extractall(stage, filter='data')
    if digest(stage / 'database.dump') != metadata['dumpSha256']:
        raise ValueError('database dump checksum mismatch')
    manifest = json.loads((stage / 'objects.json').read_text())
    expected = {'database.dump', 'objects.json', *['objects/' + obj['key'] for obj in manifest['objects']]}
    if names != expected:
        raise ValueError('archive object inventory mismatch')
    validate_objects(stage / 'objects', manifest['objects'], allow_expired=True)
    # Explicitly scrub libpq's alternate host/service/options authority for every child.
    environment = {k: v for k, v in os.environ.items() if not k.startswith('PG') and k != 'DATABASE_URL'}
    environment.update({k: os.environ[k] for k in ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSFILE', 'PGPASSWORD'] if k in os.environ})
    # createdb rejects existing targets; never clean/overwrite another database.
    run([args.createdb, '--no-password', database], env=environment)
    # Render separately so old sealed schemas receive the bounded helper correction BEFORE COPY.
    # psql owns ONE transaction across schema, correction, data and post-data constraints/indexes.
    sections = [('pre-data', 'restore-pre.sql'), ('data', 'restore-data.sql'), ('post-data', 'restore-post.sql')]
    for section, name in sections:
        path = stage / name
        os.close(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600))
        run([args.pg_restore, '--no-password', '--exit-on-error', '--section', section,
             '--file', str(path), str(stage / 'database.dump')], env=environment)
    migration = Path(__file__).resolve().parents[2] / 'packages/database/migrations/20261018000500_restore_validation_namespace.sql'
    correction = migration.read_text().split('-- migrate:up', 1)[1].split('-- migrate:down', 1)[0]
    with os.fdopen(os.open(stage / 'restore-fix.sql', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'w') as output:
        output.write(correction)
    run([args.psql, '--no-password', '-X', '--set', 'ON_ERROR_STOP=1', '--single-transaction', '--dbname', database,
         '--file', str(stage / 'restore-pre.sql'), '--file', str(stage / 'restore-fix.sql'),
         '--file', str(stage / 'restore-data.sql'), '--file', str(stage / 'restore-post.sql')], env=environment)
    # Caller supplies explicit isolated URL only to the existing owner-only import subprocess.
    from urllib.parse import quote
    environment['DATABASE_URL'] = 'postgresql:///' + database + '?host=' + quote(host, safe='')
    run([args.node, args.exclusion_script, 'import', args.exclusions], env=environment)
    expiry_result = stage / 'expiry-replay.json'
    run([args.node, str(Path(__file__).with_name('backup-expiry.mjs')), str(expiry_result)], env=environment)
    expiry = json.loads(expiry_result.read_text())
    if expiry.get('databaseExpiryReplayed') is not True:
        raise ValueError('actual expiry replay required')
    removed = remove_staged_exclusions(stage, manifest, set(expiry['keys']), dt.datetime.now(UTC))
    # The exception covers encrypted archives, never stale decrypted scratch copies.
    for name in ['snapshot.tar', 'database.dump', 'expiry-replay.json']:
        (stage / name).unlink()
    filtered = {**manifest, 'objects': [obj for obj in manifest['objects'] if (stage / 'objects' / obj['key']).exists()]}
    sanitized = stage / 'objects.sanitized.json'
    receipt(sanitized, filtered)
    os.replace(sanitized, stage / 'objects.json')
    sync_directory(stage)
    value = {'readiness': HOLD, 'databaseExpiryReplayed': True, 'stagedObjectsRemoved': removed, 'databaseRestored': True, 'erasureImportCompleted': True,
             'objectsStagedOnly': True, 'finishedAt': dt.datetime.now(UTC).isoformat()}
    receipt(stage / 'restored.json', value)
    return value


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    create = sub.add_parser('create')
    for option in ['store', 'objects', 'object-manifest', 'recipient', 'scratch']:
        create.add_argument('--' + option, required=True)
    create.add_argument('--pg-dump', default='pg_dump')
    clean = sub.add_parser('prune')
    clean.add_argument('--store', required=True)
    recover = sub.add_parser('restore')
    for option in ['artifact', 'receipt', 'identity', 'destination', 'exclusions']:
        recover.add_argument('--' + option, required=True)
    for option in ['createdb', 'pg-restore', 'psql', 'node']:
        recover.add_argument('--' + option, default=option.replace('-', '_') if option == 'pg-restore' else option)
    recover.add_argument('--exclusion-script', default=str(Path(__file__).resolve().parents[1] / 'privacy/restore-exclusions.mjs'))
    args = parser.parse_args()
    try:
        if args.action == 'prune':
            store = private_directory(args.store)
            with open(store / '.lock', 'a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                prune(store, dt.datetime.now(UTC))
            result = {'retentionCompleted': True}
        else:
            result = backup(args) if args.action == 'create' else restore(args)
        print(json.dumps(result))
    except Exception:
        print(json.dumps({'status': 'FAILED', 'readiness': HOLD}))
        raise SystemExit(1)

if __name__ == '__main__':
    main()
