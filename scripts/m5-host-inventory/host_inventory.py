"""Fixed private metadata collector; no SSH/provider/SQL/exec or host writes.
Caller authenticates authority records and owns transport/shared accounting.
LOCAL_TEST injection is a separate Python seam, unavailable in the live CLI.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import subprocess
import sys
import time

HOST, USER = '65.109.22.104', 'serveradmin'
FINGERPRINT = 'SHA256:vttVPAISQypNdyfjFElTJ6ef8Q5S2YlC+XoUn599uq4'
APP = Path('/home/serveradmin/insignia-rewrite-m5-019')
WEB, DB = 'insignia-rewrite-m5-019-web', 'insignia-rewrite-m5-019-database'
IMAGE = 'sha256:8aa439cb733160ce6b99165e8401cfbc60f612851aeef0d76735db92917dc3f5'
COMPOSE_SHA = '2cf6a39677b760570be3406e3d76280ec152ca40c4c01ba46e1ef2e4396faa4e'
PACKAGE_SHA = 'f117be50d7bc106f1c943cdf75a8080fa63c26e0edd99b7ba0ddf3eaea697c2b'
# Exact reviewed archive size: docs/delivery/evidence/m5-019/deployment-package-receipt.json.
PACKAGE_MAX_BYTES = 70310306
CAP, COMMAND_SECONDS = 1024 * 1024, 15
ENVIRONMENT = {'PATH': '/usr/bin:/bin', 'HOME': '/nonexistent', 'LANG': 'C', 'LC_ALL': 'C'}
POLICY_KEYS = ('INSIGNIA_M5_ENTITLEMENT_POLICY_JSON', 'INSIGNIA_M5_FEATURES_JSON')
PRESENCE_KEYS = ('INSIGNIA_PARTNER_ORGANIZATION_ID', 'INSIGNIA_PARTNER_ACCESS_TOKEN',
                 'SHOPIFY_WEBHOOK_SECRET', 'INSIGNIA_CREDENTIAL_KEY_ID', 'INSIGNIA_CREDENTIAL_KEY_BASE64')
PLAN = (
    {'id': 'canonical-web-runtime', 'sources': [WEB], 'selector': 'fixed-container-projection-v1'},
    {'id': 'canonical-database-runtime', 'sources': [DB], 'selector': 'fixed-container-projection-v1'},
    {'id': 'canonical-router-runtime', 'sources': ['traefik'], 'selector': 'fixed-container-projection-v1'},
    {'id': 'legacy-service-boundary', 'sources': ['insignia-app'], 'selector': 'fixed-container-projection-v1'},
    {'id': 'canonical-compose-artifact', 'sources': [str(APP / 'compose.yaml')], 'selector': 'regular-file-stat-sha256'},
    {'id': 'reviewed-web-package-artifact', 'sources': [str(APP / 'reviewed-web-package.tar.gz')], 'selector': 'regular-file-stat-sha256'},
    {'id': 'bounded-running-docker-topology', 'sources': ['local-docker-socket'], 'selector': 'running-container-id-name-image-max200'},
    {'id': 'bounded-host-process-executables', 'sources': ['/proc', 'ps'], 'selector': 'pid-parent-comm-exe-cgroup-max512'},
    {'id': 'private-config-file-modes', 'sources': [str(APP / name) for name in ('.env', 'runtime.env', 'database.env')], 'selector': 'lstat-only'},
    {'id': 'commercial-nonsecret-configuration', 'sources': [WEB], 'selector': 'exact-policy-keys-and-presence-booleans-v1'},
    {'id': 'current-queue-role-ownership', 'sources': [], 'selector': 'UNKNOWN_NO_ALLOCATED_LOCATION'},
    {'id': 'downstream-privacy-copy-ownership', 'sources': [], 'selector': 'UNKNOWN_NO_ALLOCATED_LOCATION'},
)


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


class Stop(Exception):
    def __init__(self, category):
        self.category = category


def require(condition, category='STOP_METADATA_INVALID'):
    if not condition:
        raise Stop(category)


def strict_json(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result)
            result[key] = value
        return result
    def invalid(_):
        raise Stop('STOP_METADATA_INVALID')
    return json.loads(data, object_pairs_hook=unique, parse_constant=invalid)


def text(value, limit=512):
    require(isinstance(value, str) and len(value) <= limit and not any(ord(char) < 32 for char in value))
    return value


def instant(value):
    require(isinstance(value, str), 'STOP_ENTRY_UNQUALIFIED')
    parsed = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(parsed.tzinfo is not None, 'STOP_ENTRY_UNQUALIFIED')
    return parsed.timestamp()


def parent_fd(path):
    """Open each ancestor without following links; caller closes returned fd."""
    require(path.is_absolute() and '..' not in path.parts, 'STOP_PATH_DENIED')
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    fd = os.open('/', flags)
    try:
        for part in path.parts[1:-1]:
            next_fd = os.open(part, flags, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        return fd, path.name
    except Exception:
        os.close(fd)
        raise


def source_sha():
    return digest(Path(__file__).read_bytes())


CONTAINER_FORMAT = '''{"name":{{json .Name}},"id":{{json .Id}},"image":{{json .Image}},"status":{{json .State.Status}},"startedAt":{{json .State.StartedAt}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},"user":{{json .Config.User}},"readOnlyRoot":{{json .HostConfig.ReadonlyRootfs}},"privileged":{{json .HostConfig.Privileged}},"capDrop":{{json .HostConfig.CapDrop}},"capAdd":{{json .HostConfig.CapAdd}},"securityOpt":{{json .HostConfig.SecurityOpt}},"restart":{{json .HostConfig.RestartPolicy.Name}},"mounts":[{{range $i,$m := .Mounts}}{{if $i}},{{end}}{"type":{{json $m.Type}},"source":{{json $m.Source}},"destination":{{json $m.Destination}},"writable":{{json $m.RW}}}{{end}}],"publishedPorts":{{json .HostConfig.PortBindings}},"logDriver":{{json .HostConfig.LogConfig.Type}},"canonicalRouteMatches":{{eq (index .Config.Labels "traefik.http.routers.insignia-canonical-m5-019r.rule") "Host(`insignia-app.optidigi.nl`)"}},"canonicalRouteEnabled":{{eq (index .Config.Labels "traefik.enable") "true"}}}'''


def commercial_format():
    clauses = []
    for key in POLICY_KEYS:
        clauses.append('{{if eq $key "' + key + '"}}{"key":"' + key + '","value":{{json (slice . '
                       + str(len(key) + 1) + ')}}}{{println}}{{end}}')
    for key in PRESENCE_KEYS:
        clauses.append('{{if eq $key "' + key + '"}}{"key":"' + key
                       + '","present":true,"nonempty":{{gt (len .) ' + str(len(key) + 1) + '}}}{{println}}{{end}}')
    return '{{range .Config.Env}}{{$key := index (split . "=") 0}}' + ''.join(clauses) + '{{end}}'


COMMERCIAL_FORMAT = commercial_format()
DOCKER_PREFIX = ('--host', 'unix:///var/run/docker.sock', '--config', '/nonexistent')
CONTAINER_COMMANDS = tuple(('docker', *DOCKER_PREFIX, 'inspect', '--format', CONTAINER_FORMAT, name)
                           for name in (WEB, DB, 'traefik', 'insignia-app'))
TOPOLOGY_FORMAT = '{"id":{{json .ID}},"name":{{json .Names}},"image":{{json .Image}}}'
TOPOLOGY_COMMAND = ('docker', *DOCKER_PREFIX, 'ps', '--no-trunc', '--format', TOPOLOGY_FORMAT)
PROCESS_COMMAND = ('ps', '--no-headers', '-eo', 'pid=,ppid=,comm=')
COMMERCIAL_COMMAND = ('docker', *DOCKER_PREFIX, 'inspect', '--format', COMMERCIAL_FORMAT, WEB)
ALLOWED_COMMANDS = (*CONTAINER_COMMANDS, TOPOLOGY_COMMAND, PROCESS_COMMAND, COMMERCIAL_COMMAND)
# Hash actual argv/templates as well as descriptive selectors.
SELECTOR_SHA = digest(encoded({'plan': PLAN, 'commands': ALLOWED_COMMANDS}))


def entry(request, actual_source_sha, local=False):
    require(isinstance(request, dict) and set(request) == {'mode', 'allocation', 'qualification', 'reservation'}, 'STOP_ENTRY_UNQUALIFIED')
    require(request['mode'] == ('LOCAL_TEST' if local else 'LIVE'), 'STOP_ENTRY_UNQUALIFIED')
    allocation, gate, reservation = (request[key] for key in ('allocation', 'qualification', 'reservation'))
    require(all(isinstance(value, dict) for value in (allocation, gate, reservation)), 'STOP_ENTRY_UNQUALIFIED')
    require(set(allocation) == {'id', 'host', 'user', 'port', 'readOnly', 'fingerprint', 'selectorSha256',
                               'observationIds', 'expiresAt', 'privateRetentionDays', 'auditEffectsAccounted'}, 'STOP_ENTRY_UNQUALIFIED')
    require(set(gate) == {'classification', 'sourceSha256', 'selectorSha256', 'head', 'tree',
                         'specReviewRef', 'standardsReviewRef', 'ciRef'}, 'STOP_ENTRY_UNQUALIFIED')
    require(set(reservation) == {'classification', 'allocationId', 'runId', 'sourceSha256', 'selectorSha256',
                                'host', 'user', 'port', 'fingerprint', 'fingerprintVerified', 'inspectionStartedAt',
                                'deadline', 'reservedObservationIds', 'privateCaptureReady'}, 'STOP_ENTRY_UNQUALIFIED')
    ids = [row['id'] for row in PLAN[:10]]
    require(allocation['observationIds'] == ids and reservation['reservedObservationIds'] == ids, 'STOP_ENTRY_UNQUALIFIED')
    require(allocation['readOnly'] is True and allocation['auditEffectsAccounted'] is True
            and type(allocation['privateRetentionDays']) is int and 0 < allocation['privateRetentionDays'] <= 7, 'STOP_ENTRY_UNQUALIFIED')
    require(gate['classification'] == 'FROZEN_LOCAL_GATE' and reservation['classification'] == 'SSH_READ_RESERVED'
            and reservation['fingerprintVerified'] is True and reservation['privateCaptureReady'] is True, 'STOP_ENTRY_UNQUALIFIED')
    for value in (allocation, reservation):
        require((value['host'], value['user'], value['port'], value['fingerprint']) == (HOST, USER, 22, FINGERPRINT)
                and type(value['port']) is int and value['selectorSha256'] == SELECTOR_SHA, 'STOP_ENTRY_UNQUALIFIED')
    require(gate['selectorSha256'] == SELECTOR_SHA and gate['sourceSha256'] == actual_source_sha
            and reservation['sourceSha256'] == actual_source_sha and reservation['allocationId'] == allocation['id'], 'STOP_ENTRY_UNQUALIFIED')
    for key in ('head', 'tree'):
        require(isinstance(gate[key], str) and re.fullmatch('[0-9a-f]{40}', gate[key]), 'STOP_ENTRY_UNQUALIFIED')
    for value in (allocation['id'], reservation['runId'], gate['specReviewRef'], gate['standardsReviewRef'], gate['ciRef']):
        require(isinstance(value, str) and re.fullmatch('[A-Za-z0-9._:/-]{1,256}', value), 'STOP_ENTRY_UNQUALIFIED')
    started, deadline, expiry = (instant(reservation['inspectionStartedAt']), instant(reservation['deadline']), instant(allocation['expiresAt']))
    now = time.time()
    require(started <= now < deadline <= started + 1800 and deadline <= expiry, 'STOP_INSPECTION_DEADLINE')
    return time.monotonic() + deadline - now


class Boundary:
    def __init__(self, deadline, local_bindings=None):
        self.deadline, self.local = deadline, local_bindings

    def remaining(self):
        value = self.deadline - time.monotonic()
        require(value > 0, 'STOP_INSPECTION_DEADLINE')
        return value

    def command(self, command):
        require(command in ALLOWED_COMMANDS, 'STOP_COMMAND_DENIED')
        argv = ['/usr/bin/' + command[0], *command[1:]] if self.local is None else [*self.local['command'], *command]
        timeout = min(COMMAND_SECONDS, self.remaining())
        process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                   env=ENVIRONMENT, start_new_session=True)
        chunks, size, end = [], 0, time.monotonic() + timeout
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                while selector.get_map():
                    left = min(end - time.monotonic(), self.remaining())
                    require(left > 0, 'STOP_COMMAND_TIMEOUT')
                    for key, _ in selector.select(left):
                        chunk = os.read(key.fd, min(65536, CAP + 1 - size))
                        if not chunk:
                            selector.unregister(key.fileobj)
                            continue
                        size += len(chunk)
                        require(size <= CAP, 'STOP_OUTPUT_LIMIT')
                        chunks.append(chunk)
                left = min(end - time.monotonic(), self.remaining())
                require(left > 0, 'STOP_COMMAND_TIMEOUT')
                try:
                    code = process.wait(timeout=left)
                except subprocess.TimeoutExpired:
                    raise Stop('STOP_COMMAND_TIMEOUT')
                require(code == 0, 'STOP_COMMAND_FAILED')
                return b''.join(chunks)
        finally:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
            process.stdout.close()

    def path(self, path):
        self.remaining()
        allowed_files = {Path(source) for row in PLAN[4:6] + PLAN[8:9] for source in row['sources']}
        require(path in allowed_files or re.fullmatch('/proc/[1-9][0-9]{0,9}', str(path)), 'STOP_PATH_DENIED')
        return path if self.local is None else self.local['root'] / str(path).lstrip('/')

    def artifact(self, path, expected, max_bytes):
        require(path in (APP / 'compose.yaml', APP / 'reviewed-web-package.tar.gz'), 'STOP_PATH_DENIED')
        parent, name = parent_fd(self.path(path))
        fd = None
        try:
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
            before = os.fstat(fd)
            require(stat.S_ISREG(before.st_mode) and before.st_size <= max_bytes, 'STOP_ARTIFACT_INVALID')
            hashed, size = hashlib.sha256(), 0
            while True:
                self.remaining()
                chunk = os.read(fd, 65536)
                if not chunk:
                    break
                size += len(chunk)
                require(size <= max_bytes, 'STOP_ARTIFACT_INVALID')
                hashed.update(chunk)
            after = os.fstat(fd)
            current = os.stat(name, dir_fd=parent, follow_symlinks=False)
            require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
                    (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) and size == before.st_size, 'STOP_ARTIFACT_DRIFT')
            require((before.st_dev, before.st_ino) == (current.st_dev, current.st_ino)
                    and stat.S_ISREG(current.st_mode), 'STOP_ARTIFACT_DRIFT')
            require(hashed.hexdigest() == expected, 'STOP_ARTIFACT_DRIFT')
            return {'sha256': hashed.hexdigest(), 'bytesHashed': size, 'mode': oct(stat.S_IMODE(before.st_mode))}
        finally:
            if fd is not None:
                os.close(fd)
            os.close(parent)

    def file_mode(self, path):
        require(path in (APP / '.env', APP / 'runtime.env', APP / 'database.env'), 'STOP_PATH_DENIED')
        parent, name = parent_fd(self.path(path))
        try:
            status = os.stat(name, dir_fd=parent, follow_symlinks=False)
            require(stat.S_ISREG(status.st_mode), 'STOP_ARTIFACT_INVALID')
            return {'name': path.name, 'mode': oct(stat.S_IMODE(status.st_mode)), 'contentRead': False}
        finally:
            os.close(parent)


def container(data, name):
    row = strict_json(data)
    fields = {'name', 'id', 'image', 'status', 'startedAt', 'health', 'user', 'readOnlyRoot', 'privileged',
              'capDrop', 'capAdd', 'securityOpt', 'restart', 'mounts', 'publishedPorts', 'logDriver', 'canonicalRouteMatches', 'canonicalRouteEnabled'}
    require(isinstance(row, dict) and set(row) == fields)
    require(row['name'] == '/' + name and re.fullmatch('[0-9a-f]{64}', text(row['id'])) and re.fullmatch('sha256:[0-9a-f]{64}', text(row['image'])))
    require(row['status'] in ('created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead') and row['health'] in (None, 'starting', 'healthy', 'unhealthy'))
    require(re.fullmatch('[0-9T:Z.+-]{1,64}', text(row['startedAt'])) and re.fullmatch('[A-Za-z0-9_:.+-]{0,64}', text(row['user'])))
    for key in ('readOnlyRoot', 'privileged', 'canonicalRouteMatches', 'canonicalRouteEnabled'):
        require(type(row[key]) is bool)
    for key in ('capDrop', 'capAdd', 'securityOpt'):
        require(row[key] is None or isinstance(row[key], list) and len(row[key]) <= 64
                and all(re.fullmatch('[A-Za-z0-9_:.-]{1,128}', text(value)) for value in row[key]))
    require(row['restart'] in ('', 'no', 'always', 'unless-stopped', 'on-failure') and re.fullmatch('[A-Za-z0-9_.-]{0,64}', text(row['logDriver'])))
    require(isinstance(row['mounts'], list) and len(row['mounts']) <= 64)
    for mount in row['mounts']:
        require(isinstance(mount, dict) and set(mount) == {'type', 'source', 'destination', 'writable'}
                and mount['type'] in ('bind', 'volume', 'tmpfs', 'npipe', 'cluster') and type(mount['writable']) is bool)
        for key in ('source', 'destination'):
            require(re.fullmatch('[A-Za-z0-9_./:-]{0,512}', text(mount[key])))
    require(row['publishedPorts'] is None or isinstance(row['publishedPorts'], dict))
    for port, bindings in (row['publishedPorts'] or {}).items():
        require(re.fullmatch('[0-9]{1,5}/(tcp|udp|sctp)', port) and (bindings is None or isinstance(bindings, list) and len(bindings) <= 64))
        for binding in bindings or []:
            require(isinstance(binding, dict) and set(binding) == {'HostIp', 'HostPort'}
                    and re.fullmatch('[0-9a-fA-F:.]{0,64}', text(binding['HostIp'])) and re.fullmatch('[0-9]{1,5}', text(binding['HostPort'])))
    if name == WEB:
        require(row['image'] == IMAGE, 'STOP_ARTIFACT_DRIFT')
        require(row['canonicalRouteMatches'] and row['canonicalRouteEnabled'], 'STOP_ROUTE_DRIFT')
    return row


def safe_name(value):
    require(re.fullmatch('[A-Za-z0-9_.:/-]{1,128}', text(value)))


def nonsecret_configuration(data):
    rows = [strict_json(line) for line in data.splitlines() if line.strip()]
    require(len(rows) <= len(POLICY_KEYS) + len(PRESENCE_KEYS))
    result = {'policy': None, 'features': None, 'presence': {key: {'present': False, 'nonempty': False} for key in PRESENCE_KEYS}}
    seen = set()
    for row in rows:
        require(isinstance(row, dict) and row.get('key') in (*POLICY_KEYS, *PRESENCE_KEYS) and row['key'] not in seen)
        key = row['key']
        seen.add(key)
        if key in PRESENCE_KEYS:
            require(set(row) == {'key', 'present', 'nonempty'} and row['present'] is True and type(row['nonempty']) is bool)
            result['presence'][key] = {'present': True, 'nonempty': row['nonempty']}
            continue
        require(set(row) == {'key', 'value'} and isinstance(row['value'], str))
        value = strict_json(row['value'])
        if key == POLICY_KEYS[0]:
            require(isinstance(value, dict) and set(value) == {'policyVersion', 'maxAgeMs', 'plans'}
                    and type(value['maxAgeMs']) is int and 0 < value['maxAgeMs'] <= 300000 and isinstance(value['plans'], list) and len(value['plans']) <= 100)
            safe_name(value['policyVersion'])
            handles, identities = set(), set()
            for plan in value['plans']:
                require(isinstance(plan, dict) and set(plan) == {'planHandle', 'usageHandle', 'policyId', 'features', 'includedUsage'}
                        and type(plan['includedUsage']) is int and 0 <= plan['includedUsage'] <= 9007199254740991
                        and isinstance(plan['features'], list) and len(plan['features']) <= 100)
                for field in ('planHandle', 'usageHandle', 'policyId'):
                    safe_name(plan[field])
                for feature in plan['features']:
                    safe_name(feature)
                require(plan['planHandle'] != plan['usageHandle'] and plan['planHandle'] not in handles and plan['policyId'] not in identities)
                handles.add(plan['planHandle'])
                identities.add(plan['policyId'])
            result['policy'] = value
        else:
            require(isinstance(value, dict) and set(value) == {'base', 'required', 'logoLater', 'options', 'pricing'})
            for feature in value.values():
                safe_name(feature)
            result['features'] = value
    result['providerTruth'], result['ownerCommercialApproval'] = 'UNKNOWN_NOT_QUERIED', 'UNKNOWN_NOT_ATTESTED'
    result['configurationStatus'] = ('OBSERVED_SCHEMA_ONLY' if result['policy'] is not None and result['features'] is not None
                                     else 'UNKNOWN_MISSING_CONFIGURATION')
    return result


def processes(boundary):
    lines = boundary.command(PROCESS_COMMAND).decode('ascii').splitlines()
    require(len(lines) <= 512, 'STOP_TOPOLOGY_LIMIT')
    rows = []
    for line in lines:
        parts = line.split()
        require(len(parts) == 3 and re.fullmatch('[0-9]{1,10}', parts[0]) and re.fullmatch('[0-9]{1,10}', parts[1]) and re.fullmatch('[A-Za-z0-9_.:/+-]{1,64}', parts[2]))
        pid, parent, name = parts
        base = boundary.path(Path('/proc') / pid)
        row = {'pid': pid, 'parentPid': parent, 'name': name, 'executable': None, 'supervision': None, 'classification': 'UNKNOWN_PROCESS_RACE_OR_ACCESS'}
        proc_fd = None
        try:
            proc_fd, cgroup_name = parent_fd(base / 'cgroup')
            executable = os.readlink('exe', dir_fd=proc_fd)
            require(re.fullmatch('[A-Za-z0-9_./:+ -]{1,512}', text(executable)))
            fd = os.open(cgroup_name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=proc_fd)
            try:
                raw = os.read(fd, 8193)
            finally:
                os.close(fd)
            require(len(raw) <= 8192, 'STOP_OUTPUT_LIMIT')
            groups = raw.decode('ascii').splitlines()
            require(len(groups) <= 64 and all(re.fullmatch('[0-9]+:[A-Za-z0-9_,=-]*:/[A-Za-z0-9_./:@+-]*', group) for group in groups))
            row.update({'executable': executable, 'supervision': groups, 'classification': 'METADATA_ONLY_NOT_PROCESSOR_PROOF'})
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            pass
        finally:
            if proc_fd is not None:
                os.close(proc_fd)
        rows.append(row)
    return {'processes': rows, 'globalAbsenceProven': False, 'remoteProcessors': 'UNKNOWN_NOT_ALLOCATED'}


def _collect(request, actual_source_sha, bindings=None):
    observations, attempted = [], []
    local = bindings is not None
    try:
        boundary = Boundary(entry(request, actual_source_sha, local), bindings)
        for index, plan in enumerate(PLAN):
            boundary.remaining()
            if index >= 10:
                observations.append({'id': plan['id'], 'classification': 'UNKNOWN_NOT_ALLOCATED'})
                continue
            attempted.append(plan['id'])
            observation_classification = 'METADATA_OBSERVED_NATIVE_UNQUALIFIED'
            if index < 4:
                try:
                    data = boundary.command(CONTAINER_COMMANDS[index])
                except Stop as error:
                    # Only these two fixed optional commands may be unavailable.
                    # Nonzero exit proves neither absence nor its cause; discard output.
                    if index not in (2, 3) or error.category != 'STOP_COMMAND_FAILED':
                        raise
                    metadata = {'containerState': 'UNKNOWN', 'failureCause': 'UNKNOWN', 'globalAbsenceProven': False}
                    observation_classification = 'UNAVAILABLE_COMMAND_FAILED'
                else:
                    metadata = container(data, plan['sources'][0])
            elif index in (4, 5):
                expected = COMPOSE_SHA if index == 4 else PACKAGE_SHA
                if local:
                    expected = bindings['artifactHashes'][index - 4]
                metadata = boundary.artifact(Path(plan['sources'][0]), expected, CAP if index == 4 else PACKAGE_MAX_BYTES)
            elif index == 6:
                rows = [strict_json(line) for line in boundary.command(TOPOLOGY_COMMAND).splitlines()]
                require(len(rows) <= 200, 'STOP_TOPOLOGY_LIMIT')
                ids = set()
                for row in rows:
                    require(isinstance(row, dict) and set(row) == {'id', 'name', 'image'}, 'STOP_TOPOLOGY_LIMIT')
                    require(re.fullmatch('[0-9a-f]{64}', text(row['id'])) and row['id'] not in ids, 'STOP_TOPOLOGY_LIMIT')
                    require(re.fullmatch('[A-Za-z0-9_.-]{1,128}', text(row['name']))
                            and re.fullmatch('[A-Za-z0-9_./:@-]{1,512}', text(row['image'])), 'STOP_TOPOLOGY_LIMIT')
                    ids.add(row['id'])
                metadata = {'runningContainers': rows, 'processorCoverage': 'UNKNOWN', 'globalAbsenceProven': False}
            elif index == 7:
                metadata = processes(boundary)
            elif index == 8:
                metadata = [boundary.file_mode(Path(value)) for value in plan['sources']]
            else:
                metadata = nonsecret_configuration(boundary.command(COMMERCIAL_COMMAND))
            observation = {'id': plan['id'], 'classification': observation_classification, 'metadata': metadata}
            require(len(encoded(observation)) <= CAP, 'STOP_OUTPUT_LIMIT')
            observations.append(observation)
        classification = ('LOCAL_TEST_' if local else '') + 'METADATA_OBSERVED_NATIVE_UNQUALIFIED'
    except Stop as error:
        classification = error.category
    except Exception:
        classification = 'STOP_LOCAL_OR_METADATA_FAILURE'
    result = {'classification': classification, 'observations': observations, 'attemptedObservationIds': attempted,
              'observationLimit': 12, 'providerRequests': 0, 'hostWrites': 0, 'productionSql': 0, 'globalAbsenceProven': False, 'retryAuthorized': False}
    require(len(encoded(result)) <= 12 * CAP + 65536, 'STOP_OUTPUT_LIMIT')
    return result


def collect(request):
    """Live on-disk entry; caller verifies authority-record authenticity."""
    return _collect(request, source_sha())


def collect_verified_source(request, source_bytes):
    """Trusted stdin loader supplies EXACT executed source bytes, not a digest.
    Caller validates transmitted code before execution; not an untrusted API.
    """
    require(isinstance(source_bytes, bytes) and len(source_bytes) <= CAP, 'STOP_ENTRY_UNQUALIFIED')
    return _collect(request, digest(source_bytes))


def collect_local_test(request, bindings):
    """Explicit LOCAL_TEST-only public boundary, unavailable via the live CLI."""
    require(isinstance(bindings, dict) and set(bindings) == {'command', 'root', 'artifactHashes'}, 'STOP_TEST_BINDING_INVALID')
    require(request.get('mode') == 'LOCAL_TEST', 'STOP_TEST_BINDING_INVALID')
    return _collect(request, source_sha(), bindings)


def main():
    try:
        require(sys.argv[1:] == ['collect'], 'STOP_ENTRY_UNQUALIFIED')
        raw = sys.stdin.buffer.read(65537)
        require(len(raw) <= 65536, 'STOP_ENTRY_UNQUALIFIED')
        result = collect(strict_json(raw))
    except Exception:
        result = {'classification': 'STOP_ENTRY_UNQUALIFIED', 'observations': [], 'attemptedObservationIds': [], 'retryAuthorized': False}
    sys.stdout.buffer.write(encoded(result) + b'\n')
    return 0 if result['classification'] == 'METADATA_OBSERVED_NATIVE_UNQUALIFIED' else 1


if __name__ == '__main__':
    sys.exit(main())
