"""Private exact-app receiver bootstrap. No web deployment or provider dispatch.

Only the qualified receiver can later collect in response to authenticated Publish.
Existing SSH/SDK custody is reused; private startup bytes are never logged or stored.
"""
import hashlib
import json
import os
from pathlib import Path
import shlex
import signal
import select
import socket
import stat
import subprocess
import sys
import time
import urllib.parse

REPOSITORY = Path(__file__).resolve().parents[2]
PARENT = Path('/home/serveradmin/insignia-milestone-autonomy-handoff')
DIRECTORY = PARENT / 'm5-release-verification'
REMOTE_DIRECTORY = '/home/serveradmin/insignia-m5-runtime-resource-run-20261011-fb240660/publication-verification-bridge'
NODE = '/home/serveradmin/.local/opt/node-v24.21.0-linux-x64/bin/node'
SSH = ['ssh', '-F', '/dev/null', '-T', '-i', '/home/serveradmin/.ssh/id_t3_prod',
       '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ForwardAgent=no',
       '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
       '-o', 'UserKnownHostsFile=' + str(PARENT / 'm5-normal-runtime-readonly-20261010/known_hosts.public')]
TARGET = 'serveradmin@65.109.22.104'
UNIT = 'insignia-m5-release-verifier.service'
SERVICE = REPOSITORY / 'deployment/m5-runtime/release-verifier.service'

REMOTE = r'''
import json,pathlib,os,stat,subprocess
def require(condition):
 if not condition: raise RuntimeError('remote_binding_unqualified')
v=json.loads(subprocess.check_output(['docker','inspect','insignia-rewrite-m5-019-web'],timeout=10))[0]
require(v['Id'] == G['webContainer'] and v['Image'] == G['webImage'] and (v['State']['Health']['Status'] == 'healthy'))
env=dict(item.split('=',1) for item in v['Config']['Env'])
require(env['SHOPIFY_CLIENT_ID'] == '1443cf6d03d39edae7c101a943c5c684' and env['APP_URL'] == 'https://insignia-app.optidigi.nl')
db=json.loads(subprocess.check_output(['docker','inspect',G['databaseContainer']],timeout=10))[0]
require(db['State']['Health']['Status'] == 'healthy' and db['Image'] == G['databaseImage'])
p=pathlib.Path('/home/serveradmin/insignia-m5-runtime-resource-run-20261011-fb240660/schema-plan/credentials.json')
s=p.lstat();require(stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid() and s.st_mode&0o777==0o600 and s.st_size<=16384)
credentials=json.loads(p.read_text())
bridge=pathlib.Path('/home/serveradmin/insignia-m5-runtime-resource-run-20261011-fb240660/publication-verification-bridge')
require(not bridge.exists());bridge.mkdir(mode=0o700)
require(bridge.lstat().st_uid == os.getuid() and (not (bridge / 'collector.sock').exists()))
print(json.dumps({'clientSecret':env['SHOPIFY_CLIENT_SECRET'],'databaseUrl':env['DATABASE_URL'],
 'appendPassword':credentials['releasePassword'],
 'databaseIp':db['NetworkSettings']['Networks']['insignia-rewrite-m5-019_private']['IPAddress']}))
'''

def require(condition, reason='binding_unqualified'):
    if not condition: raise RuntimeError(reason)


def require_service():
    result = subprocess.check_output(['systemctl','--user','show',UNIT,
        '--property=MainPID','--property=KillMode','--property=Restart','--property=ControlGroup',
        '--property=FragmentPath','--property=DropInPaths'],
        text=True,timeout=5)
    values = dict(line.split('=',1) for line in result.splitlines())
    require(values['MainPID'] == str(os.getpid()) and values['KillMode'] == 'control-group' and values['Restart'] == 'no')
    require(values['ControlGroup'] and ('0::'+values['ControlGroup']) in Path('/proc/self/cgroup').read_text().splitlines())
    require(not values['DropInPaths'] and Path(values['FragmentPath']).read_bytes() == SERVICE.read_bytes())


def private_json(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and (stat.S_IMODE(info.st_mode) == 384))
        require(info.st_size <= 1048576)
        data = os.read(fd, 1048577)
        require(len(data) <= 1048576)
        return json.loads(data)
    finally:
        os.close(fd)


def qualify_gate(gate):
    require(gate['version'] == 'm5-private-collector-binding-v1')
    require(gate['spec'] == gate['security'] == 'CLEAR' and gate['exactHeadCiAttempt1'] is True)
    require(gate['producerSha256'] == hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    require(gate['userServiceCrashQualified'] is True and gate['serviceSha256'] == hashlib.sha256(SERVICE.read_bytes()).hexdigest())
    for ref, expected in [('HEAD', gate['head']), ('HEAD^{tree}', gate['tree'])]:
        require(subprocess.check_output(['git', 'rev-parse', ref], cwd=REPOSITORY, text=True).strip() == expected)
    require(not subprocess.check_output(['git', 'status', '--porcelain'], cwd=REPOSITORY))
    manifest = PARENT / ('m5-trusted-release-launch-qualified-inputs-' + gate['head'] + '.json')
    require(hashlib.sha256(manifest.read_bytes()).hexdigest() == gate['inputManifestSha256'])
    metadata = private_json(manifest)
    require(metadata['reviewedHead'] == gate['head'] and metadata['reviewedTree'] == gate['tree'])
    code = "import {qualifyLaunchInputs} from './scripts/m5-runtime/trusted-release-launch.mjs';import {readFileSync} from 'node:fs';await qualifyLaunchInputs(JSON.parse(readFileSync(" + json.dumps(str(manifest)) + ",'utf8')));"
    subprocess.run([NODE,'--input-type=module','-e',code],cwd=REPOSITORY,
        stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True,timeout=30)


def start(gate):
    qualify_gate(gate)
    require_service()
    require(not DIRECTORY.exists())
    DIRECTORY.mkdir(mode=0o700)
    intent = DIRECTORY/'binding-intent.json'
    fd = os.open(intent, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd,'w') as output:
        json.dump({'version':'m5-private-binding-intent-v1','head':gate['head'],'tree':gate['tree'],
            'operation':'CREATE_PRIVATE_METADATA_BRIDGE','retryAuthorized':False},output)
        output.flush(); os.fsync(output.fileno())
    descriptor = os.open(DIRECTORY, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)
    children = []
    def spawn(command, **options):
        child = subprocess.Popen(command, **options); children.append(child); return child
    def interrupted(*_):
        raise RuntimeError('binding_interrupted')
    for name in [signal.SIGTERM, signal.SIGINT]: signal.signal(name, interrupted)
    config = {}; packet = {}
    try:
        code = 'G=' + repr({k:gate[k] for k in ['webContainer','webImage','databaseContainer','databaseImage']}) + '\n' + REMOTE
        read = spawn(SSH + ['-o','ClearAllForwardings=yes',TARGET,'python3 -c ' + shlex.quote(code)], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        raw, _ = read.communicate(timeout=30)
        require(read.returncode == 0 and len(raw) <= 16384)
        config = json.loads(raw); raw = None
        with socket.socket() as selected:
            selected.bind(('127.0.0.1',0)); port = selected.getsockname()[1]
        tunnel = spawn(SSH + ['-o','ClearAllForwardings=no','-o','ExitOnForwardFailure=yes',
            '-o','StreamLocalBindMask=0177','-o','StreamLocalBindUnlink=no','-N',
            '-L',f"127.0.0.1:{port}:{config['databaseIp']}:5432",'-R',REMOTE_DIRECTORY + '/collector.sock:' + str(DIRECTORY/'collector.sock'),TARGET],
            stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        for _ in range(50):
            require(tunnel.poll() is None)
            try:
                with socket.create_connection(('127.0.0.1',port),timeout=.2): break
            except OSError: time.sleep(.1)
        else: raise RuntimeError('forward_unavailable')
        address = urllib.parse.urlsplit(config['databaseUrl'])
        require(address.username == 'insignia_runtime' and address.password)
        import uuid
        packet = {'recordId':str(uuid.uuid4()),'clientSecret':config['clientSecret'],'appendPassword':config['appendPassword'],
            'databaseUrl':urllib.parse.urlunsplit((address.scheme,address.netloc.rsplit('@',1)[0]+'@127.0.0.1:'+str(port),address.path,'sslmode=disable',''))}
        config.clear()
        receiver = spawn([NODE,str(REPOSITORY/'scripts/m5-runtime/release-verification-native.mjs')],
            cwd=REPOSITORY,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
            env={'HOME':'/home/serveradmin','PATH':str(Path(NODE).parent)+':/usr/bin:/bin','LANG':'C.UTF-8','TERM':'dumb'})
        receiver.stdin.write(json.dumps(packet).encode()); receiver.stdin.close(); packet.clear()
        # The parent consumes only this closed nonsecret startup line.
        ready, _, _ = select.select([receiver.stdout], [], [], 15)
        require(ready, 'receiver_startup_unsettled')
        line = bytearray()
        until = time.monotonic() + 15
        while b'\n' not in line:
            ready, _, _ = select.select([receiver.stdout], [], [], max(0, until-time.monotonic()))
            require(ready and time.monotonic() < until, 'receiver_startup_unsettled')
            chunk = os.read(receiver.stdout.fileno(), 4097-len(line))
            require(chunk and len(line) + len(chunk) <= 4096)
            line.extend(chunk)
        require(json.loads(line)['classification'] == 'PRIVATE_COLLECTOR_LISTENING_NOT_NATIVE_QUALIFICATION')
        print('{"classification":"PRIVATE_BINDING_LISTENING_NO_PROVIDER_REQUEST"}',flush=True)
        while receiver.poll() is None:
            require(tunnel.poll() is None)
            time.sleep(.2)
        require(receiver.returncode == 0)
    finally:
        config.clear(); packet.clear()
        for child in reversed(children):
            if child.poll() is None: child.terminate()
        for child in reversed(children):
            try: child.wait(timeout=10)
            except subprocess.TimeoutExpired: child.kill(); child.wait()
        # The qualified user service owns the complete cgroup. Main-process
        # death terminates detached descendants too; no reservation is removed.

if __name__ == '__main__':
    try:
        require(len(sys.argv) == 2)
        start(private_json(sys.argv[1]))
    except Exception:
        print('{"classification":"PRIVATE_BINDING_STOPPED_NO_RETRY"}',flush=True)
        sys.exit(1)
