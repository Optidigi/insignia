"""Private bounded phase ledger. Declarations require parent-checked provenance.
No provider/token path; fixed native SSH transport is the sole external seam.
"""
import datetime
import base64
import fcntl
import hashlib
import json
import os
import re
from pathlib import Path
import stat
import shlex
import subprocess
import selectors
import signal
import time
import uuid

CAP = 1048576

class Stop(Exception):
    def __init__(self, category):
        self.category = category

def require(condition, category='STOP_PHASE_UNQUALIFIED'):
    if not condition:
        raise Stop(category)

def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()

def digest(value):
    return hashlib.sha256(value).hexdigest()

def instant(value):
    parsed = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(parsed.tzinfo is not None)
    return parsed.timestamp()

def timestamp(value):
    return datetime.datetime.fromtimestamp(value, datetime.timezone.utc).isoformat()

def private_dir(path):
    path = Path(path)
    require(path.is_absolute() and str(path.resolve()) == str(path) and re.fullmatch('/[A-Za-z0-9_./-]+', str(path)), 'STOP_PHASE_UNAVAILABLE')
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700 and info.st_uid == os.getuid(), 'STOP_PHASE_UNAVAILABLE')
    return path

def fsync_dir(directory):
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def durable(directory, name, data):
    fd = os.open(directory / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb', closefd=False) as file:
            file.write(data)
            file.flush()
        os.fsync(fd)
    finally:
        os.close(fd)
    fsync_dir(directory)

def read_private(directory, name, limit=65536):
    fd = os.open(directory / name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600 and info.st_uid == os.getuid(), 'STOP_PHASE_UNAVAILABLE')
        with os.fdopen(fd, 'rb', closefd=False) as file:
            raw = file.read(limit+1)
        require(len(raw) <= limit, 'STOP_PHASE_UNAVAILABLE')
        return raw
    finally:
        os.close(fd)

def save(directory, state):
    durable(directory, 'ledger.pending', encoded(state))
    os.replace(directory/'ledger.pending', directory/'ledger.json')
    fsync_dir(directory)

def load(directory, allow_expired=False):
    state = json.loads(read_private(directory, 'ledger.json'))
    allocation_bytes = read_private(directory, 'allocation.json')
    gate_bytes = read_private(directory, 'qualification.json')
    require(state['schema'] == 'insignia-inventory-phase-ledger-v1' and
            state['allocationSha256'] == digest(allocation_bytes) and
            state['qualificationSha256'] == digest(gate_bytes), 'STOP_PHASE_BINDING_DRIFT')
    allocation, gate = json.loads(allocation_bytes), json.loads(gate_bytes)
    require(gate['phaseSourceSha256'] == digest(Path(__file__).read_bytes()), 'STOP_PHASE_BINDING_DRIFT')
    require(not state['closed'], 'STOP_PHASE_CLOSED')
    require(allow_expired or time.time() < instant(state['deadline']), 'STOP_SHARED_DEADLINE')
    return state, allocation, gate

class Locked:
    def __init__(self, directory):
        self.directory = private_dir(directory)
    def __enter__(self):
        self.fd = os.open(self.directory/'lock', os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
        info = os.fstat(self.fd)
        require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600 and info.st_uid == os.getuid(), 'STOP_PHASE_UNAVAILABLE')
        fcntl.flock(self.fd, fcntl.LOCK_EX)
        return self.directory
    def __exit__(self, *_):
        os.close(self.fd)

def summary(category, state=None):
    return {'classification': category, 'reservedAdminRequests': 0 if state is None else state['adminRequests'],
            'reservedOwnerSurfaces': 0 if state is None else len(state['ownerSurfaces']),
            'reservedMetadataObservations': 0 if state is None else state['metadataObservations'],
            'nativeSafety': 'UNQUALIFIED', 'retryAuthorized': False}

def validate_declarations(allocation, gate):
    require(isinstance(allocation, dict) and isinstance(gate, dict))
    require(set(allocation) >= {'schema', 'mode', 'classification', 'ownerApprovalReference', 'expiresAt',
                               'retentionDeleteBy', 'retentionOwner', 'allowedMutations', 'ceilings', 'ownerSurfaceIds', 'privatePhaseDirectory'})
    require(set(allocation) <= {'schema', 'mode', 'classification', 'ownerApprovalReference', 'expiresAt',
                               'retentionDeleteBy', 'retentionOwner', 'allowedMutations', 'ceilings', 'ownerSurfaceIds',
                               'hostAllocation', 'hostAccess', 'privatePhaseDirectory'})
    require(allocation['schema'] == 'insignia-inventory-phase-allocation-v1' and allocation['mode'] in ('LIVE', 'LOCAL_TEST')
            and allocation['classification'] == 'OWNER_GRANTED_BOUNDED_READ_ONLY' and allocation['allowedMutations'] == [])
    require(set(gate) >= {'classification', 'allocationSha256', 'phaseSourceSha256', 'head', 'tree',
                         'specReviewRef', 'standardsReviewRef', 'ciRef'})
    require(set(gate) <= {'classification', 'allocationSha256', 'phaseSourceSha256', 'head', 'tree',
                         'specReviewRef', 'standardsReviewRef', 'ciRef', 'hostQualification'})
    require(gate['classification'] == 'FROZEN_LOCAL_GATE' and gate['allocationSha256'] == digest(encoded(allocation))
            and gate['phaseSourceSha256'] == digest(Path(__file__).read_bytes()))
    for value in (allocation['ownerApprovalReference'], allocation['retentionOwner'],
                  gate['specReviewRef'], gate['standardsReviewRef'], gate['ciRef']):
        require(isinstance(value, str) and re.fullmatch('[A-Za-z0-9._:/-]{1,256}', value))
    for key in ('head', 'tree'):
        require(isinstance(gate[key], str) and re.fullmatch('[0-9a-f]{40}', gate[key]))
    now = time.time()
    require(instant(allocation['expiresAt']) > now and now < instant(allocation['retentionDeleteBy']) <= now + 7*86400)
    maxima = {'adminRequests': 3, 'ownerSurfaces': 3, 'metadataObservations': 12,
              'bytesPerObservation': CAP, 'activeSeconds': 1800}
    ceilings = allocation['ceilings']
    require(isinstance(ceilings, dict) and set(ceilings) == set(maxima))
    require(all(type(ceilings[key]) is int and 0 < ceilings[key] <= limit for key, limit in maxima.items()))
    surfaces = allocation['ownerSurfaceIds']
    require(isinstance(surfaces, list) and len(surfaces) <= ceilings['ownerSurfaces'] and len(surfaces) == len(set(surfaces))
            and all(isinstance(value, str) and re.fullmatch('[A-Za-z0-9_-]{1,64}', value) for value in surfaces))

def create_phase(directory, allocation, qualification):
    try:
        require(len(encoded(allocation)) <= 65536 and len(encoded(qualification)) <= 65536)
        allocation, qualification = json.loads(encoded(allocation)), json.loads(encoded(qualification))
        validate_declarations(allocation, qualification)
        directory = Path(directory)
        require(str(directory) == allocation['privatePhaseDirectory'])
        private_dir(directory.parent)
        require(directory.is_absolute() and str(directory.resolve()) == str(directory), 'STOP_PHASE_UNAVAILABLE')
        now = time.time()
        os.mkdir(directory, 0o700)
        fsync_dir(directory.parent)
        durable(directory, 'lock', b'')
        durable(directory, 'allocation.json', encoded(allocation))
        durable(directory, 'qualification.json', encoded(qualification))
        deadline = min(now + allocation['ceilings']['activeSeconds'], instant(allocation['expiresAt']), instant(allocation['retentionDeleteBy']))
        state = {'schema': 'insignia-inventory-phase-ledger-v1', 'phaseId': str(uuid.uuid4()),
                 'pid': os.getpid(), 'startedAt': timestamp(now), 'deadline': timestamp(deadline),
                 'allocationSha256': digest(encoded(allocation)), 'qualificationSha256': digest(encoded(qualification)),
                 'adminRequests': 0, 'ownerSurfaces': [], 'metadataObservations': 0, 'host': None, 'closed': False}
        save(directory, state)
        return summary('PHASE_CREATED_RESOURCES_UNQUALIFIED', state)
    except Stop as error:
        return summary(error.category)
    except Exception:
        return summary('STOP_PHASE_UNAVAILABLE')

def reserve_admin(directory, collector_allocation):
    try:
        with Locked(directory) as directory:
            state, allocation, gate = load(directory)
            require(state['adminRequests'] == 0, 'STOP_RESERVATION_CONSUMED')
            require(allocation['ceilings']['adminRequests'] == 3)
            require(collector_allocation['schema'] == 'insignia-native-inventory-allocation-v1' and
                    collector_allocation['privateEvidenceDirectory'] == str(directory/'admin'))
            require(collector_allocation['ceilings']['requests'] == 3)
            constrained = json.loads(encoded(collector_allocation))
            constrained['validUntil'] = timestamp(min(instant(state['deadline']), instant(constrained['validUntil'])))
            constrained['ceilings']['durationMs'] = min(constrained['ceilings']['durationMs'],
                                                      int((instant(constrained['validUntil'])-time.time())*1000))
            require(constrained['ceilings']['durationMs'] > 0, 'STOP_SHARED_DEADLINE')
            state['adminRequests'] = 3
            state['adminStatus'] = 'RESERVED_NOT_OBSERVED'
            save(directory, state)
            binding = {'phaseId': state['phaseId'], 'phaseAllocationSha256': state['allocationSha256'],
                       'phaseQualificationSha256': state['qualificationSha256'], 'startedAt': state['startedAt'],
                       'deadline': state['deadline'], 'reservedRequests': 3, 'collectorAllocation': constrained}
            durable(directory, 'admin-allocation.json', encoded(constrained))
            binding['collectorAllocationSha256'] = digest(encoded(constrained))
            durable(directory, 'admin-binding.json', encoded(binding))
            state['adminAllocationSha256'] = digest(encoded(constrained))
            state['adminBindingSha256'] = digest(encoded(binding))
            save(directory, state)
            return summary('ADMIN_REQUESTS_RESERVED_NOT_OBSERVED', state)
    except Stop as error:
        return summary(error.category)
    except Exception:
        return summary('STOP_PHASE_UNAVAILABLE')

def reserve_owner_surface(directory, surface_id):
    try:
        with Locked(directory) as directory:
            state, allocation, _ = load(directory)
            require(surface_id in allocation['ownerSurfaceIds'], 'STOP_SURFACE_UNALLOCATED')
            require(not any(row['id'] == surface_id for row in state['ownerSurfaces']), 'STOP_RESERVATION_CONSUMED')
            require(len(state['ownerSurfaces']) < allocation['ceilings']['ownerSurfaces'], 'STOP_PHASE_LIMIT')
            state['ownerSurfaces'].append({'id': surface_id, 'status': 'RESERVED_NOT_OBSERVED', 'reservedAt': timestamp(time.time())})
            save(directory, state)
            return summary('OWNER_SURFACE_RESERVED_NOT_OBSERVED', state)
    except Stop as error:
        return summary(error.category)
    except Exception:
        return summary('STOP_PHASE_UNAVAILABLE')

def close_phase(directory):
    try:
        with Locked(directory) as directory:
            state, _, _ = load(directory, allow_expired=True)
            state['closed'] = True
            state['closedAt'] = timestamp(time.time())
            save(directory, state)
            return summary('PHASE_CLOSED_RESERVATIONS_NOT_PROOF', state)
    except Stop as error:
        return summary(error.category)
    except Exception:
        return summary('STOP_PHASE_UNAVAILABLE')

HOST, USER = '65.109.22.104', 'serveradmin'
FINGERPRINT = 'SHA256:vttVPAISQypNdyfjFElTJ6ef8Q5S2YlC+XoUn599uq4'
OBSERVATION_IDS = ['canonical-web-runtime', 'canonical-database-runtime', 'canonical-router-runtime',
    'legacy-service-boundary', 'canonical-compose-artifact', 'reviewed-web-package-artifact',
    'bounded-running-docker-topology', 'bounded-host-process-executables', 'private-config-file-modes',
    'commercial-nonsecret-configuration']
UNKNOWN_IDS = ['current-queue-role-ownership', 'downstream-privacy-copy-ownership']

def frozen_remote_command(source_sha256):
    require(isinstance(source_sha256, str) and re.fullmatch('[0-9a-f]{64}', source_sha256))
    loader = ("import base64,hashlib,json,sys\n"
              "try:\n"
              " raw=sys.stdin.buffer.read(1460001)\n"
              " assert len(raw)<=1460000\n"
              " envelope=json.loads(raw)\n"
              " assert set(envelope)=={'source','request'}\n"
              " source=base64.b64decode(envelope['source'],validate=True)\n"
              " assert len(source)<=1048576\n"
              " assert hashlib.sha256(source).hexdigest()==" + repr(source_sha256) + "\n"
              " namespace={'__name__':'m5_host_inventory','__file__':'<stdin>'}\n"
              " exec(compile(source,'<stdin>','exec'),namespace)\n"
              " result=namespace['collect_verified_source'](envelope['request'],source)\n"
              " sys.stdout.buffer.write(namespace['encoded'](result)+b'\\n')\n"
              " sys.exit(0 if result['classification']=='METADATA_OBSERVED_NATIVE_UNQUALIFIED' else 1)\n"
              "except Exception:\n"
              " sys.stdout.write('{\"classification\":\"STOP_REMOTE_LOADER\"}\\n')\n"
              " sys.exit(1)\n")
    return 'exec env -i PATH=/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C /usr/bin/python3 -I -B -c ' + shlex.quote('exec('+repr(loader)+')')

def verified_pin(line, expected):
    require(isinstance(line, str) and len(line) <= 16384 and '\n' not in line and '\r' not in line, 'STOP_HOST_PIN')
    fields = line.split()
    require(len(fields) == 3 and fields[0] == HOST and re.fullmatch('[A-Za-z0-9@._+-]{1,128}', fields[1]), 'STOP_HOST_PIN')
    blob = base64.b64decode(fields[2], validate=True)
    require(4 <= len(blob) <= 8192, 'STOP_HOST_PIN')
    length = int.from_bytes(blob[:4], 'big')
    require(0 < length <= 128 and blob[4:4+length].decode('ascii') == fields[1], 'STOP_HOST_PIN')
    actual = 'SHA256:' + base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip('=')
    require(actual == expected, 'STOP_HOST_PIN')
    return fields[1]

def ssh_arguments(key_path, pin_path, algorithm, command):
    options = ['BatchMode=yes', 'IdentitiesOnly=yes', 'IdentityAgent=none', 'NumberOfPasswordPrompts=0',
               'PasswordAuthentication=no', 'KbdInteractiveAuthentication=no', 'PreferredAuthentications=publickey',
               'ForwardAgent=no', 'ForwardX11=no', 'ClearAllForwardings=yes', 'PermitLocalCommand=no',
               'ProxyCommand=none', 'ProxyJump=none', 'CanonicalizeHostname=no', 'ControlMaster=no',
               'ControlPath=none', 'ControlPersist=no', 'StrictHostKeyChecking=yes', 'CheckHostIP=yes',
               'UpdateHostKeys=no', 'VerifyHostKeyDNS=no', 'GlobalKnownHostsFile=/dev/null',
               'UserKnownHostsFile='+str(pin_path), 'HostKeyAlgorithms='+algorithm, 'ConnectionAttempts=1',
               'ConnectTimeout=15', 'ServerAliveInterval=0', 'Compression=no', 'RequestTTY=no']
    return ['-F', '/dev/null', '-T', '-x', '-p', '22', '-i', str(key_path), '-l', USER,
            *[value for option in options for value in ('-o', option)], HOST, command]

HOST_OUTPUT_CAP = 12*CAP+65536

def bounded_process(argv, payload, directory, deadline):
    remaining = deadline-time.time()
    require(remaining > 0, 'STOP_SHARED_DEADLINE')
    timeout = min(300, remaining)
    outputs = {name: os.open(directory/name, os.O_WRONLY | os.O_NOFOLLOW) for name in ('host-stdout.private','host-stderr.private')}
    process = None
    chunks, written, total, error_bytes = [], 0, 0, 0
    end = time.monotonic()+timeout
    try:
        for fd in outputs.values():
            info = os.fstat(fd)
            require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and
                    stat.S_IMODE(info.st_mode) == 0o600 and info.st_size == 0, 'STOP_PRIVATE_CAPTURE')
        process = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env={'PATH': '/usr/bin:/bin', 'HOME': '/nonexistent', 'LANG': 'C', 'LC_ALL': 'C'}, start_new_session=True)
        with selectors.DefaultSelector() as selector:
            for stream, event, kind in ((process.stdin, selectors.EVENT_WRITE, 'input'),
                                        (process.stdout, selectors.EVENT_READ, 'output'),
                                        (process.stderr, selectors.EVENT_READ, 'error')):
                os.set_blocking(stream.fileno(), False)
                selector.register(stream, event, kind)
            while selector.get_map():
                left = min(end-time.monotonic(), deadline-time.time())
                require(left > 0, 'STOP_SSH_TIMEOUT')
                for key, _ in selector.select(left):
                    if key.data == 'input':
                        try:
                            written += os.write(key.fd, payload[written:written+65536])
                        except BrokenPipeError:
                            selector.unregister(key.fileobj)
                            key.fileobj.close()
                            continue
                        if written == len(payload):
                            selector.unregister(key.fileobj)
                            key.fileobj.close()
                        continue
                    data = os.read(key.fd, 65536)
                    if not data:
                        selector.unregister(key.fileobj)
                        continue
                    capacity = HOST_OUTPUT_CAP-total
                    if key.data == 'error':
                        capacity = min(capacity, 65536-error_bytes)
                    kept = data[:max(0, capacity)]
                    fd = outputs['host-stderr.private' if key.data == 'error' else 'host-stdout.private']
                    with os.fdopen(fd, 'wb', closefd=False) as output:
                        output.write(kept)
                        output.flush()
                    total += len(kept)
                    if key.data == 'error':
                        error_bytes += len(kept)
                    else:
                        chunks.append(kept)
                    require(len(kept) == len(data), 'STOP_SSH_OUTPUT_LIMIT')
            left = min(end-time.monotonic(), deadline-time.time())
            require(left > 0, 'STOP_SSH_TIMEOUT')
            try:
                code = process.wait(timeout=left)
            except subprocess.TimeoutExpired:
                raise Stop('STOP_SSH_TIMEOUT')
            require(written == len(payload), 'STOP_SSH_OR_REMOTE_FAILURE')
            return code, b''.join(chunks)
    finally:
        if process is not None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
            for stream in (process.stdin, process.stdout, process.stderr):
                stream.close()
        for fd in outputs.values():
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        fsync_dir(directory)

def strict_json(raw):
    def unique(pairs):
        value = {}
        for key, item in pairs:
            require(key not in value, 'STOP_HOST_RESULT_INVALID')
            value[key] = item
        return value
    def invalid(_):
        raise Stop('STOP_HOST_RESULT_INVALID')
    return json.loads(raw, object_pairs_hook=unique, parse_constant=invalid)

def validate_host_result(result, observation_cap):
    fields = {'classification', 'observations', 'attemptedObservationIds', 'observationLimit',
              'providerRequests', 'hostWrites', 'productionSql', 'globalAbsenceProven', 'retryAuthorized'}
    require(isinstance(result, dict) and set(result) == fields, 'STOP_HOST_RESULT_INVALID')
    require(result['classification'] == 'METADATA_OBSERVED_NATIVE_UNQUALIFIED' and
            result['attemptedObservationIds'] == OBSERVATION_IDS and result['globalAbsenceProven'] is False and
            result['retryAuthorized'] is False, 'STOP_HOST_RESULT_INVALID')
    for key in ('providerRequests', 'hostWrites', 'productionSql'):
        require(type(result[key]) is int and result[key] == 0, 'STOP_HOST_RESULT_INVALID')
    require(type(result['observationLimit']) is int and result['observationLimit'] == 12, 'STOP_HOST_RESULT_INVALID')
    observations = result['observations']
    require(isinstance(observations, list) and len(observations) == 12, 'STOP_HOST_RESULT_INVALID')
    for index, name in enumerate(OBSERVATION_IDS+UNKNOWN_IDS):
        row = observations[index]
        require(isinstance(row, dict) and row.get('id') == name and len(encoded(row)) <= observation_cap, 'STOP_HOST_RESULT_INVALID')
        if index < 10:
            require(set(row) == {'id', 'classification', 'metadata'} and
                    row['classification'] == 'METADATA_OBSERVED_NATIVE_UNQUALIFIED' and
                    isinstance(row['metadata'], (dict, list)), 'STOP_HOST_RESULT_INVALID')
        else:
            require(set(row) == {'id', 'classification'} and row['classification'] == 'UNKNOWN_NOT_ALLOCATED', 'STOP_HOST_RESULT_INVALID')

def validate_host_entry(host, gate, access):
    require(isinstance(host, dict) and set(host) == {'id', 'host', 'user', 'port', 'readOnly', 'fingerprint',
            'selectorSha256', 'observationIds', 'expiresAt', 'privateRetentionDays', 'auditEffectsAccounted'})
    require(isinstance(gate, dict) and set(gate) == {'classification', 'sourceSha256', 'selectorSha256',
            'head', 'tree', 'specReviewRef', 'standardsReviewRef', 'ciRef'})
    require(isinstance(access, dict) and set(access) == {'identityPath', 'knownHostLineSha256',
            'forcedCommandSha256', 'forcedCommandAttestationRef'})
    require(gate['classification'] == 'FROZEN_LOCAL_GATE' and (host['host'], host['user'], host['port']) == (HOST, USER, 22)
            and type(host['port']) is int and host['readOnly'] is True and host['auditEffectsAccounted'] is True
            and host['observationIds'] == OBSERVATION_IDS and type(host['privateRetentionDays']) is int
            and 0 < host['privateRetentionDays'] <= 7 and instant(host['expiresAt']) > time.time())
    for value in (host['id'], gate['specReviewRef'], gate['standardsReviewRef'], gate['ciRef'], access['forcedCommandAttestationRef']):
        require(isinstance(value, str) and re.fullmatch('[A-Za-z0-9._:/-]{1,256}', value))
    for key in ('head', 'tree'):
        require(isinstance(gate[key], str) and re.fullmatch('[0-9a-f]{40}', gate[key]))
    for value in (host['selectorSha256'], gate['sourceSha256'], gate['selectorSha256'],
                  access['knownHostLineSha256'], access['forcedCommandSha256']):
        require(isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value))

def read_source(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_size <= CAP, 'STOP_SOURCE_DRIFT')
        with os.fdopen(fd, 'rb', closefd=False) as file:
            source = file.read(CAP+1)
        require(len(source) <= CAP, 'STOP_SOURCE_DRIFT')
        return source
    finally:
        os.close(fd)

def run_host_inventory(directory, source_path, key_path, known_host_line, test_command=None):
    state = None
    reservation_created = False
    try:
        with Locked(directory) as directory:
            state, allocation, gate = load(directory)
            require(state['host'] is None, 'STOP_RESERVATION_CONSUMED')
            require(test_command is None or allocation['mode'] == 'LOCAL_TEST', 'STOP_TEST_TRANSPORT_DENIED')
            require(test_command is not None or allocation['mode'] == 'LIVE', 'STOP_TEST_TRANSPORT_DENIED')
            host, host_gate, access = allocation['hostAllocation'], gate['hostQualification'], allocation['hostAccess']
            validate_host_entry(host, host_gate, access)
            require(allocation['ceilings']['bytesPerObservation'] == CAP, 'STOP_PHASE_LIMIT')
            require((host['host'], host['user'], host['port']) == (HOST, USER, 22))
            require(host['readOnly'] is True and host['auditEffectsAccounted'] is True and host['observationIds'] == OBSERVATION_IDS)
            require(allocation['mode'] == 'LOCAL_TEST' or host['fingerprint'] == FINGERPRINT, 'STOP_HOST_PIN')
            require(host_gate['classification'] == 'FROZEN_LOCAL_GATE')
            source_path = Path(source_path)
            source = read_source(source_path)
            require(len(source) <= CAP and digest(source) == host_gate['sourceSha256'], 'STOP_SOURCE_DRIFT')
            namespace = {'__name__': 'm5_host_inventory', '__file__': '<frozen-source>'}
            exec(compile(source, '<frozen-source>', 'exec'), namespace)
            if allocation['mode'] == 'LIVE':
                require((namespace.get('HOST'), namespace.get('USER'), namespace.get('FINGERPRINT')) == (HOST, USER, FINGERPRINT), 'STOP_SOURCE_DRIFT')
            selector_sha = digest(encoded({'plan': namespace['PLAN'], 'commands': namespace['ALLOWED_COMMANDS']}))
            require(selector_sha == namespace['SELECTOR_SHA'] == host_gate['selectorSha256'] == host['selectorSha256'], 'STOP_SELECTOR_DRIFT')
            require([row['id'] for row in namespace['PLAN']] == OBSERVATION_IDS+UNKNOWN_IDS, 'STOP_SELECTOR_DRIFT')
            command = frozen_remote_command(host_gate['sourceSha256'])
            require(digest(command.encode()) == access['forcedCommandSha256'] and access['forcedCommandAttestationRef'])
            require(digest(known_host_line.encode()) == access['knownHostLineSha256'], 'STOP_HOST_PIN')
            algorithm = verified_pin(known_host_line, host['fingerprint'])
            key_path = Path(key_path)
            require(re.fullmatch(r'/[A-Za-z0-9_./-]+', str(key_path)) is not None
                    and str(key_path) == access['identityPath'] and key_path.is_absolute()
                    and key_path.resolve() == key_path, 'STOP_KEY_METADATA')
            key_info = key_path.lstat()
            require(stat.S_ISREG(key_info.st_mode) and stat.S_IMODE(key_info.st_mode) == 0o600 and key_info.st_uid == os.getuid(), 'STOP_KEY_METADATA')
            require(state['metadataObservations']+10 <= allocation['ceilings']['metadataObservations'], 'STOP_PHASE_LIMIT')
            require(time.time() < min(instant(state['deadline']), instant(host['expiresAt'])), 'STOP_SHARED_DEADLINE')
            durable(directory, 'known_hosts.private', (known_host_line+'\n').encode())
            durable(directory, 'forced-command.txt', command.encode())
            durable(directory, 'host-stdout.private', b'')
            durable(directory, 'host-stderr.private', b'')
            state['metadataObservations'] += 10
            state['host'] = {'status': 'RESERVED', 'reservedObservationIds': OBSERVATION_IDS,
                             'sourceSha256': host_gate['sourceSha256'], 'selectorSha256': selector_sha,
                             'forcedCommandSha256': digest(command.encode()), 'invocations': 1, 'callerPid': os.getpid()}
            save(directory, state)
            reservation_created = True
            request = {'mode': 'LIVE', 'allocation': host, 'qualification': host_gate,
                       'reservation': {'classification': 'SSH_READ_RESERVED', 'allocationId': host['id'], 'runId': state['phaseId'],
                                       'sourceSha256': host_gate['sourceSha256'], 'selectorSha256': selector_sha,
                                       'host': HOST, 'user': USER, 'port': 22, 'fingerprint': host['fingerprint'],
                                       'fingerprintVerified': True, 'inspectionStartedAt': state['startedAt'],
                                       'deadline': timestamp(min(instant(state['deadline']), instant(host['expiresAt']))),
                                       'reservedObservationIds': OBSERVATION_IDS, 'privateCaptureReady': True}}
            payload = encoded({'source': base64.b64encode(source).decode(), 'request': request})
            argv = ['/usr/bin/ssh'] if test_command is None else list(test_command)
            argv += ssh_arguments(key_path, directory/'known_hosts.private', algorithm, command)
        code, stdout = bounded_process(argv, payload, directory, min(instant(state['deadline']), instant(host['expiresAt'])))
        result = strict_json(stdout)
        require(code == 0, 'STOP_SSH_OR_REMOTE_FAILURE')
        validate_host_result(result, allocation['ceilings']['bytesPerObservation'])
        with Locked(directory) as directory:
            current, _, _ = load(directory)
            current['host']['status'] = 'CAPTURED_NATIVE_UNQUALIFIED'
            current['host']['attemptedObservationIds'] = result['attemptedObservationIds']
            save(directory, current)
            return summary('HOST_METADATA_CAPTURED_NATIVE_UNQUALIFIED', current)
    except Stop as error:
        category = error.category
    except Exception:
        category = 'STOP_SSH_OR_PRIVATE_IO_UNCERTAIN'
    if reservation_created and state is not None and state.get('host') is not None:
        try:
            with Locked(directory) as directory:
                current, _, _ = load(directory, allow_expired=True)
                current['host']['status'] = 'UNCERTAIN_NO_RETRY'
                current['closed'] = True
                current['closedAt'] = timestamp(time.time())
                current['stopClassification'] = category
                save(directory, current)
                state = current
        except Exception:
            pass  # Durable reservation/directory remains consumed even if sealing fails.
    return summary(category, state)

def main(argv):
    import sys
    usage = 'Usage: phase.py create DIR ALLOCATION QUALIFICATION | admin DIR COLLECTOR_ALLOCATION | owner-surface DIR ID | host DIR SOURCE IDENTITY KNOWN_HOST_FILE | close DIR | frozen-command SOURCE_SHA256'
    try:
        if argv == ['--help']:
            sys.stdout.write(usage+'\n')
            return 0
        def private_input(path):
            path = Path(path)
            return read_private(private_dir(path.parent), path.name)
        if len(argv) == 2 and argv[0] == 'frozen-command':
            sys.stdout.write(frozen_remote_command(argv[1])+'\n')
            return 0
        if len(argv) == 4 and argv[0] == 'create':
            result = create_phase(argv[1], strict_json(private_input(argv[2])), strict_json(private_input(argv[3])))
        elif len(argv) == 3 and argv[0] == 'admin':
            result = reserve_admin(argv[1], strict_json(private_input(argv[2])))
        elif len(argv) == 3 and argv[0] == 'owner-surface':
            result = reserve_owner_surface(argv[1], argv[2])
        elif len(argv) == 5 and argv[0] == 'host':
            pin = private_input(argv[4]).decode('ascii').removesuffix('\n')
            result = run_host_inventory(argv[1], argv[2], argv[3], pin)
        elif len(argv) == 2 and argv[0] == 'close':
            result = close_phase(argv[1])
        else:
            result = summary('STOP_PHASE_UNQUALIFIED')
    except Exception:
        result = summary('STOP_PHASE_UNQUALIFIED')
    sys.stdout.buffer.write(encoded(result)+b'\n')
    return 1 if result['classification'].startswith('STOP_') else 0

if __name__ == '__main__':
    import sys
    sys.exit(main(sys.argv[1:]))
