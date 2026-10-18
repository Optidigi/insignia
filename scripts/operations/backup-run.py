#!/usr/bin/env python3
"""One allocated Insignia writer exclusion, snapshot, backup and exact resume."""
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import uuid

ROLES = {'web', 'worker', 'inspector', 'verifier', 'maintenance', 'release-verifier', 'artwork-inspector'}


def fingerprint(row):
    # Secrets may participate in this in-memory hash; they never enter receipts/output.
    value = {name: row.get(name) for name in ['Id', 'Name', 'Image', 'Config', 'HostConfig', 'Mounts']}
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def sync_directory(path):
    directory = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def durable(path, value):
    temporary = path.parent / ('.journal-' + str(uuid.uuid4()) + '.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'w') as output:
            json.dump(value, output)
            output.flush()
            os.fsync(output.fileno())
        os.link(temporary, path, follow_symlinks=False)
        sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)
        sync_directory(path.parent)


def admit_journals(receipts):
    """A lost /run directory never erases durable unsettled Docker authority."""
    inspected = 0
    for journal in receipts.iterdir():
        if not re.fullmatch('[a-f0-9-]{36}', journal.name):
            continue
        inspected += 1
        if inspected > 4096:
            raise ValueError('prior writer operation requires reconciliation: journal limit')
        private(journal)
        has_intent = any(journal.glob('stop-*.json')) or any(journal.glob('start-*.json'))
        if not has_intent:
            continue  # An interrupted read-only preflight has no writer effect.
        try:
            def read_record(name):
                path = journal / name
                info = path.lstat()
                if path.is_symlink() or not path.is_file() or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_size > 65536:
                    raise ValueError('private journal record required')
                return json.loads(path.read_text())
            preflight = read_record('preflight.json')
            resumed = read_record('resumed.json')
            if (preflight['id'] != journal.name or resumed.get('id') != journal.name or
                    resumed.get('readiness') != 'ORIGINAL_WRITERS_RESUMED' or
                    resumed.get('containers') != preflight['containers'] or
                    resumed.get('original') != preflight['original']):
                raise ValueError('terminal identity mismatch')
        except Exception as error:
            raise ValueError('prior writer operation requires reconciliation') from error


def private(path):
    path = Path(path)
    info = path.lstat()
    if path.is_symlink() or not path.is_dir() or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError('private owned directory required')
    return path


class Docker:
    def __init__(self, executable):
        self.executable = executable

    def inspect(self, item):
        result = subprocess.run([self.executable, 'container', 'inspect', item['id']], check=True, capture_output=True, timeout=15)
        rows = json.loads(result.stdout)
        if len(rows) != 1:
            raise ValueError('container identity unavailable')
        return rows[0]

    def stop(self, item):
        subprocess.run([self.executable, 'container', 'stop', '--time', '45', item['id']], check=True, capture_output=True, timeout=60)

    def start(self, item):
        subprocess.run([self.executable, 'container', 'start', item['id']], check=True, capture_output=True, timeout=30)


def verify(config, item, row):
    labels = row.get('Config', {}).get('Labels') or {}
    if (row.get('Id') != item['id'] or row.get('Image') != item['imageId'] or
            row.get('Name') != '/' + item['name'] or fingerprint(row) != item['configSha256'] or
            labels.get('com.docker.compose.project') != config['project'] or
            labels.get('com.docker.compose.service') != item['service']):
        raise ValueError('allocated writer identity drift')


def execute(config, docker, work):
    if any(os.environ.get(name) for name in ['PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR', 'PGOPTIONS', 'DATABASE_URL']) or ',' in os.environ.get('PGHOST', '') or ',' in os.environ.get('PGPORT', '') or any(value in os.environ.get('PGDATABASE', '') for value in ['://', '=']):
        raise ValueError('alternate source database authority forbidden')
    if (config.get('format') != 'insignia-backup-run-v1' or
            not re.fullmatch(r'insignia-[a-z0-9-]+', config.get('project', '')) or
            not isinstance(config.get('windowSeconds'), int) or not 60 <= config['windowSeconds'] <= 3600):
        raise ValueError('reviewed Insignia run configuration required')
    items = config['containers']
    if not items or len(items) > 8 or len({i['id'] for i in items}) != len(items) or len({i['service'] for i in items}) != len(items):
        raise ValueError('exact writer allowlist required')
    for item in items:
        if (item['service'] not in ROLES or not item['name'].startswith(config['project']+'-') or
                not re.fullmatch('[a-f0-9]{64}', item['id']) or
                not re.fullmatch('sha256:[a-f0-9]{64}', item['imageId']) or
                not re.fullmatch('[a-f0-9]{64}', item['configSha256']) or
                not isinstance(item.get('healthRequired'), bool)):
            raise ValueError('unsupported writer allocation')
    runtime = private(config['runtimeDirectory'])
    receipts = private(config.get('receiptDirectory', str(runtime)))
    with open(receipts / '.operator.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        admit_journals(receipts)
        original = {}
        for item in items:
            row = docker.inspect(item)
            verify(config, item, row)
            if row['State']['Status'] not in ('running', 'exited', 'created'):
                raise ValueError('unsettled writer state')
            if row['State']['Status'] == 'running' and item['healthRequired'] and row['State'].get('Health', {}).get('Status') != 'healthy':
                raise ValueError('writer health unavailable')
            original[item['id']] = {'status': row['State']['Status'], 'restarts': row['RestartCount']}
        run_id = str(uuid.uuid4())
        journal = receipts / run_id
        journal.mkdir(mode=0o700)
        sync_directory(receipts)
        durable(journal/'preflight.json', {'id':run_id, 'containers':items, 'original':original})
        # Refuse stale windows/output; an interrupted run requires inspection rather than reuse.
        window_path = runtime/'window.json'
        if window_path.exists() or window_path.is_symlink():
            raise ValueError('stale exclusion requires operator inspection')
        attempted = []
        uncertain = set()
        def stopped():
            for item in items:
                row = docker.inspect(item)
                verify(config, item, row)
                if row['State']['Status'] not in ('exited', 'created') or row['RestartCount'] != original[item['id']]['restarts']:
                    raise ValueError('writer resumed or restarted during exclusion')
        try:
            for item in items:
                if original[item['id']]['status'] == 'running':
                    durable(journal/('stop-'+item['service']+'.json'), {'id':item['id'], 'action':'STOP_INTENDED'})
                    attempted.append(item)
                    try:
                        docker.stop(item)
                    except BaseException:
                        uncertain.add(item['id'])
                        raise
                    durable(journal/('stopped-'+item['service']+'.json'), {'id':item['id'], 'action':'STOP_ACKNOWLEDGED'})
            stopped()
            now = dt.datetime.now(dt.timezone.utc)
            durable(window_path, {'id':run_id, 'startedAt':now.isoformat(), 'until':(now+dt.timedelta(seconds=config['windowSeconds'])).isoformat()})
            work(window_path, stopped)
            stopped()
            durable(journal/'backup-completed.json', {'completedAt':dt.datetime.now(dt.timezone.utc).isoformat()})
        finally:
            # Close admission before restoring any writer, including on backup failure.
            if window_path.exists():
                window_path.unlink()
                directory = os.open(runtime, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(directory)
                finally:
                    os.close(directory)
            errors = []
            for item in reversed(attempted):
                if item['id'] in uncertain:
                    errors.append(item['service'])
                    continue
                try:
                    row = docker.inspect(item)
                    verify(config, item, row)
                    if row['RestartCount'] != original[item['id']]['restarts']:
                        raise ValueError('restart drift; manual settlement required')
                    if row['State']['Status'] == 'exited':
                        durable(journal/('start-'+item['service']+'.json'), {'id':item['id'], 'action':'START_INTENDED'})
                        docker.start(item)
                    deadline = time.monotonic()+45
                    while True:
                        row = docker.inspect(item)
                        verify(config, item, row)
                        if row['RestartCount'] != original[item['id']]['restarts']:
                            raise ValueError('resume restart drift')
                        if row['State']['Status']=='running' and (not item['healthRequired'] or row['State'].get('Health',{}).get('Status')=='healthy'):
                            break
                        if time.monotonic() >= deadline:
                            raise ValueError('writer did not recover')
                        time.sleep(.5)
                except Exception:
                    errors.append(item['service'])
            if errors:
                durable(journal/'resume-hold.json', {'readiness':'HOLD_OPERATOR_SETTLEMENT', 'services':errors})
                raise ValueError('writer resume needs operator settlement')
            durable(journal/'resumed.json', {'id':run_id, 'readiness':'ORIGINAL_WRITERS_RESUMED', 'containers':items, 'original':original})


def main():
    os.umask(0o077)
    path = Path(sys.argv[1])
    info = path.lstat()
    if path.is_symlink() or not path.is_file() or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_size > 16384:
        raise ValueError('private reviewed configuration required')
    config = json.loads(path.read_text())
    if 'promisedCleanupAt' not in config:
        raise ValueError('explicit promised cleanup policy required')
    if config['promisedCleanupAt'] is not None:
        cutoff=dt.datetime.fromisoformat(config['promisedCleanupAt'].replace('Z','+00:00'))
        if cutoff.tzinfo is None or cutoff<=dt.datetime.now(dt.timezone.utc):
            raise ValueError('promised cleanup cutoff expired or invalid')
    os.environ['BACKUP_PROMISED_CLEANUP_AT'] = config['promisedCleanupAt'] or 'none'
    if not config.get('receiptDirectory'):
        raise ValueError('durable operator journal directory required')
    if config.get('replicaRequired', False) and not config.get('replicaConfig'):
        raise ValueError('required off-host replica configuration missing')
    runtime = private(config['runtimeDirectory'])
    # The parent service provisions this dedicated tmpfs directory afresh per run.
    if list(runtime.iterdir()):
        raise ValueError('interrupted runtime requires operator inspection')
    if subprocess.check_output(['stat','-f','-c','%T',str(runtime)]).strip() != b'tmpfs':
        raise ValueError('tmpfs required')
    def work(window, stopped):
        objects = runtime/'objects'; objects.mkdir(mode=0o700)
        manifest = runtime/'objects.json'
        commands = [
            [config['node'], str(Path(__file__).with_name('backup-snapshot.mjs')), str(objects), str(manifest), str(window)],
            [sys.executable, str(Path(__file__).with_name('backup.py')), 'create', '--store', config['store'], '--scratch', str(runtime/'scratch'), '--objects', str(objects), '--object-manifest', str(manifest), '--recipient', config['recipient'], '--pg-dump', config['pgDump']],
        ]
        window_value = json.loads(window.read_text())
        remaining = (dt.datetime.fromisoformat(window_value['until'])-dt.datetime.now(dt.timezone.utc)).total_seconds()
        deadline = time.monotonic()+remaining
        for command in commands:
            process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            try:
                while process.poll() is None:
                    stopped()
                    if time.monotonic() >= deadline:
                        raise ValueError('exclusion budget exhausted')
                    time.sleep(.5)
                if process.returncode:
                    raise ValueError('snapshot/backup failed')
            except BaseException:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL); process.wait()
                raise
    execute(config, Docker(config['docker']), work)
    offhost = bool(config.get('replicaConfig'))
    if offhost:
        subprocess.run([config['node'], str(Path(__file__).with_name('backup-replica.mjs')), 'replicate', config['replicaConfig']], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3600)
    print(json.dumps({'backupRunCompleted':True, 'offhostReplicated':offhost, 'readiness':'OFFHOST_CIPHERTEXT_VERIFIED' if offhost else 'LOCAL_BACKUP_ONLY_OFFHOST_UNCONFIGURED'}))

if __name__=='__main__':
    def interrupted(*_):
        raise InterruptedError('operator interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    try:
        main()
    except Exception:
        print(json.dumps({'backupRunCompleted':False,'readiness':'HOLD_OPERATOR_INSPECTION'}))
        raise SystemExit(1)
