#!/usr/bin/env python3
"""One allocated Insignia writer exclusion, snapshot, backup and exact resume."""
import datetime as dt
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
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
                    resumed.get('original') != preflight['original'] or
                    resumed.get('hostInspector') != preflight.get('hostInspector') or
                    resumed.get('inspectorOriginal') != preflight.get('inspectorOriginal')):
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
        subprocess.run([self.executable, 'container', 'stop', '--timeout', '-1', item['id']], check=True, capture_output=True, timeout=360)
        state = self.inspect(item)['State']
        if state['Status']!='exited' or state['ExitCode'] not in (0,143) or state['OOMKilled']:
            raise ValueError('writer drain needs settlement')

    def start(self, item):
        subprocess.run([self.executable, 'container', 'start', item['id']], check=True, capture_output=True, timeout=30)


def verify_inspector_artifact(release, expected):
    """Verify before executing the bootstrap, from this independent operator."""
    release = Path(release)
    raw = (release/'manifest.json').read_bytes()
    if len(raw)>4*1024*1024 or hashlib.sha256(raw).hexdigest()!=expected:
        raise ValueError('inspector artifact manifest drift')
    manifest = json.loads(raw)
    if manifest.get('version')!='insignia-artwork-inspector-artifact-v1':
        raise ValueError('inspector artifact format drift')
    remaining = set(manifest['files'])
    total = 0
    for parent, directories, names in os.walk(release,followlinks=False):
        directory = Path(parent); info = directory.lstat()
        if directory.is_symlink() or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o700:
            raise ValueError('inspector artifact directory drift')
        links = [name for name in directories if (directory/name).is_symlink()]
        for name in links: directories.remove(name)
        for name in names+links:
            path = directory/name; key = str(path.relative_to(release)); info = path.lstat()
            if key in ['manifest.json','receipt.json','artwork-inspection.service']:
                if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid():
                    raise ValueError('inspector artifact metadata drift')
                continue
            entry = manifest['files'].get(key)
            if entry is None or info.st_uid!=os.getuid():
                raise ValueError('inspector artifact inventory drift')
            remaining.remove(key)
            if entry['kind']=='link':
                if not path.is_symlink() or os.readlink(path)!=entry['target'] or not path.resolve().is_relative_to(release.resolve()):
                    raise ValueError('inspector artifact link drift')
            elif entry['kind']=='file':
                total += info.st_size
                if (not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode)!=entry['mode'] or
                        info.st_size>512*1024*1024 or total>2*1024*1024*1024):
                    raise ValueError('inspector artifact file drift')
                with path.open('rb') as source:
                    digest=hashlib.file_digest(source,'sha256').hexdigest()
                if digest!=entry['sha256']:
                    raise ValueError('inspector artifact bytes drift')
            else:
                raise ValueError('inspector artifact entry drift')
    if remaining:
        raise ValueError('inspector artifact files missing')


class InspectorService:
    """The single approved host inspector, never a caller-selected command/unit."""
    UNIT = 'insignia-artwork-inspection.service'
    PROPERTIES = ['Id','LoadState','ActiveState','SubState','MainPID','InvocationID','Job',
        'FragmentPath','DropInPaths','ExecStart','WorkingDirectory','Environment','EnvironmentFiles',
        'UnsetEnvironment','Restart','TimeoutStopUSec','KillMode','NoNewPrivileges','MemoryMax',
        'MemorySwapMax','CPUQuotaPerSecUSec','TasksMax']

    def __init__(self, config):
        if config.get('unit') != self.UNIT or os.getuid() != 1000:
            raise ValueError('qualified inspector user service required')
        self.config = config
        self.process = None
        self.artifact = None

    def command(self, *args, timeout=15):
        return subprocess.run(['/usr/bin/systemctl','--user',*args], check=True,
            capture_output=True, timeout=timeout).stdout

    @staticmethod
    def file_hash(path):
        path = Path(path)
        info = path.lstat()
        if (not path.is_absolute() or path.is_symlink() or not stat.S_ISREG(info.st_mode) or
                info.st_uid != os.getuid() or info.st_size > 4*1024*1024):
            raise ValueError('owned inspector file required')
        return hashlib.sha256(path.read_bytes()).hexdigest()

    @staticmethod
    def process_identity(pid):
        try:
            # A reused PID is not the stopped service's process.
            return Path('/proc',str(pid),'stat').read_text().rsplit(')',1)[1].split()[19]
        except FileNotFoundError:
            return None

    def inspect(self):
        props = dict(line.split('=',1) for line in self.command('show',self.UNIT,
            *('--property='+name for name in self.PROPERTIES)).decode().splitlines())
        if (props['Id'] != self.UNIT or props['LoadState'] != 'loaded' or props['Job'] or
                props['Restart'] != 'no' or props['KillMode'] != 'control-group' or
                props['TimeoutStopUSec'] != 'infinity'):
            raise ValueError('inspector drain contract unavailable')
        active = props.pop('ActiveState'); sub = props.pop('SubState')
        pid = int(props.pop('MainPID')); invocation = props.pop('InvocationID')
        loaded = re.fullmatch(r'\{ path=([^;]+) ; argv\[\]=([^;]+) ; ignore_errors=no ; .* \}',props['ExecStart'])
        release = Path(props['WorkingDirectory'])
        if (not loaded or release.parent != Path.home()/'insignia-artwork-releases' or
                not re.fullmatch('[a-f0-9]{40}',release.name)):
            raise ValueError('immutable inspector command required')
        manifest = self.file_hash(release/'manifest.json')
        expected = f'{release}/bin/node {release}/start.mjs --manifest-sha256 {manifest}'
        if loaded[1] != str(release/'bin/node') or loaded[2] != expected:
            raise ValueError('inspector artifact binding drift')
        props['ExecStart'] = expected
        self.artifact = (release,manifest)
        files = [props['FragmentPath'], *props['DropInPaths'].split(),
            self.config['startupFile'],self.config['storageFile'],str(release/'manifest.json')]
        if props['EnvironmentFiles'] != self.config['startupFile']+' (ignore_errors=no)':
            raise ValueError('inspector startup binding drift')
        identities = {name:self.file_hash(name) for name in files}
        for name in [self.config['startupFile'],self.config['storageFile']]:
            if Path(name).stat().st_mode & 0o077:
                raise ValueError('private inspector custody required')
        ready = Path(self.config['readinessSocket']); directory = ready.parent
        info = directory.lstat()
        directory_identity = {'device':info.st_dev,'inode':info.st_ino,'uid':info.st_uid,'mode':stat.S_IMODE(info.st_mode)}
        if (ready.name != 'ready.sock' or directory.is_symlink() or not stat.S_ISDIR(info.st_mode) or
                info.st_uid != os.getuid() or directory_identity['mode'] != 0o700):
            raise ValueError('private inspector socket directory required')
        identity = {'properties':props,'files':identities,'readinessDirectory':directory_identity,'readinessSocket':str(ready)}
        digest = hashlib.sha256(json.dumps(identity,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        jobs = json.loads(self.command('list-units','--type=service','--state=active,activating,deactivating','--output=json','--no-legend','--no-pager') or b'[]')
        jobs += json.loads(self.command('list-jobs','--output=json','--no-legend','--no-pager') or b'[]')
        sandbox = any(re.fullmatch(r'insignia-artwork-[a-f0-9-]{36}\.service',row['unit']) for row in jobs)
        token = None
        if active=='active' and sub=='running' and pid>0 and re.fullmatch('[a-f0-9]{32}',invocation):
            token = self.process_identity(pid)
            if token is None:
                raise ValueError('inspector process unavailable')
            if self.process is None:
                self.process = (pid,token)
            status = 'running'
        elif active=='inactive' and sub=='dead' and pid==0:
            if self.process and self.process_identity(self.process[0]) == self.process[1]:
                raise ValueError('inspector process remains after stop')
            status = 'exited'
        else:
            raise ValueError('inspector state unsettled')
        return {'configSha256':digest,'status':status,'invocation':invocation,'process':{'pid':pid,'startTicks':token},'jobs':sandbox,'socket':ready.exists()}

    def verify_artifact(self):
        if self.artifact is None:
            raise ValueError('inspector artifact not bound')
        verify_inspector_artifact(*self.artifact)

    def ready(self):
        path = self.config['readinessSocket']
        try:
            info = Path(path).lstat()
        except FileNotFoundError:
            return False
        if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode)!=0o600:
            return False
        class UnixHTTP(http.client.HTTPConnection):
            def connect(self):
                self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
                self.sock.settimeout(self.timeout); self.sock.connect(path)
        connection=UnixHTTP('localhost',timeout=4)
        try:
            connection.request('GET','/artwork-ready'); response=connection.getresponse()
            return response.status==200 and json.loads(response.read(1024))=={'ready':True}
        finally:
            connection.close()

    def stop(self):
        # The unit's infinity drain remains intact; timeout kills only this client.
        self.command('stop',self.UNIT,timeout=360)

    def start(self):
        self.command('start',self.UNIT,timeout=60)
        deadline=time.monotonic()+45
        while True:
            row=self.inspect()
            if row['status']=='running' and not row['jobs'] and self.ready():
                return
            if time.monotonic()>=deadline:
                raise ValueError('inspector readiness unavailable after start')
            time.sleep(.5)


def verify(config, item, row):
    labels = row.get('Config', {}).get('Labels') or {}
    if (row.get('Id') != item['id'] or row.get('Image') != item['imageId'] or
            row.get('Name') != '/' + item['name'] or fingerprint(row) != item['configSha256'] or
            labels.get('com.docker.compose.project') != item.get('project', config['project']) or
            labels.get('com.docker.compose.service') != item['service']):
        raise ValueError('allocated writer identity drift')


def execute(config, docker, work, inspector=None):
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
        project = item.get('project', config['project'])
        if (not isinstance(project, str) or not re.fullmatch(r'insignia-[a-z0-9-]+', project) or
                item['service'] not in ROLES or not item['name'].startswith(project+'-') or
                not re.fullmatch('[a-f0-9]{64}', item['id']) or
                not re.fullmatch('sha256:[a-f0-9]{64}', item['imageId']) or
                not re.fullmatch('[a-f0-9]{64}', item['configSha256']) or
                not isinstance(item.get('healthRequired'), bool)):
            raise ValueError('unsupported writer allocation')
    host = config.get('hostInspector')
    if host is not None:
        if (host.get('unit') != 'insignia-artwork-inspection.service' or
                not re.fullmatch('[a-f0-9]{64}', host.get('configSha256', '')) or inspector is None):
            raise ValueError('qualified host inspector required')
    elif inspector is not None:
        raise ValueError('unexpected host inspector')
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
        def inspector_state():
            row = inspector.inspect()
            if row['configSha256'] != host['configSha256'] or row['jobs'] or row['status'] not in ('running','exited'):
                raise ValueError('host inspector identity or settlement drift')
            return row
        inspector_original = inspector_state() if host else None
        if host:
            inspector.verify_artifact()
        if host and inspector_original['status']=='running' and not inspector.ready():
            raise ValueError('host inspector not ready')
        if host and inspector_state()!=inspector_original:
            raise ValueError('host inspector changed during preflight')
        run_id = str(uuid.uuid4())
        journal = receipts / run_id
        journal.mkdir(mode=0o700)
        sync_directory(receipts)
        preflight = {'id':run_id, 'containers':items, 'original':original, 'hostInspector':host, 'inspectorOriginal':inspector_original}
        durable(journal/'preflight.json', preflight)
        # Refuse stale windows/output; an interrupted run requires inspection rather than reuse.
        window_path = runtime/'window.json'
        if window_path.exists() or window_path.is_symlink():
            raise ValueError('stale exclusion requires operator inspection')
        attempted = []
        uncertain = set()
        inspector_attempted = False
        inspector_uncertain = False
        def inspector_stopped():
            nonlocal inspector_uncertain
            try:
                row = inspector_state()
                if row['status']!='exited' or row['socket'] or row['invocation'] not in ('',inspector_original['invocation']):
                    raise ValueError('host inspector resumed during exclusion')
            except BaseException:
                inspector_uncertain = True
                raise
        def stopped():
            for item in items:
                row = docker.inspect(item)
                verify(config, item, row)
                if row['State']['Status'] not in ('exited', 'created') or row['RestartCount'] != original[item['id']]['restarts']:
                    raise ValueError('writer resumed or restarted during exclusion')
            if host:
                inspector_stopped()
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
            if host and inspector_original['status']=='running':
                inspector_uncertain = True
                inspector.verify_artifact()
                if inspector_state()!=inspector_original:
                    raise ValueError('host inspector replaced before stop')
                durable(journal/'stop-host-inspector.json', {'action':'STOP_INTENDED','invocation':inspector_original['invocation']})
                inspector_attempted = True
                inspector_uncertain = True
                inspector.stop()
                inspector_uncertain = False
                inspector_stopped()
                durable(journal/'stopped-host-inspector.json', {'action':'STOP_ACKNOWLEDGED'})
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
            if host:
                try:
                    if inspector_uncertain:
                        raise ValueError('host inspector needs settlement')
                    if inspector_attempted:
                        inspector.verify_artifact()
                        inspector_stopped()
                        durable(journal/'start-host-inspector.json', {'action':'START_INTENDED'})
                        inspector.start()
                        row = inspector_state()
                        if (row['status']!='running' or row['invocation']==inspector_original['invocation'] or not inspector.ready()):
                            raise ValueError('host inspector resume not ready')
                    elif inspector_state() != inspector_original:
                        raise ValueError('untouched host inspector drift')
                except Exception:
                    errors.append('host-inspector')
            for item in reversed(attempted):
                if 'host-inspector' in errors:
                    errors.append(item['service'])
                    continue
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
            durable(journal/'resumed.json', {**preflight, 'readiness':'ORIGINAL_WRITERS_RESUMED'})


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
    inspector = InspectorService(config['hostInspector']) if config.get('hostInspector') else None
    execute(config, Docker(config['docker']), work, inspector)
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
