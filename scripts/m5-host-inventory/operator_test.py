"""Synthetic LOCAL_TEST controls; real fixed-command subprocesses and temp files."""
import datetime
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import time
import unittest

OPERATOR = Path(__file__).with_name('host_inventory.py')
SPEC = importlib.util.spec_from_file_location('host_inventory', OPERATOR)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
BAIT = 'SYNTHETIC_TOKEN_DO_NOT_CAPTURE'


def envelope():
    now = datetime.datetime.now(datetime.timezone.utc)
    timestamp = lambda value: value.isoformat()
    ids = [row['id'] for row in MODULE.PLAN[:10]]
    sha = MODULE.source_sha()
    return {
        'mode': 'LOCAL_TEST',
        'allocation': {'id': 'SYNTHETIC_LOCAL_ALLOCATION', 'host': MODULE.HOST, 'user': MODULE.USER, 'port': 22,
                       'readOnly': True, 'fingerprint': MODULE.FINGERPRINT, 'selectorSha256': MODULE.SELECTOR_SHA,
                       'observationIds': ids, 'expiresAt': timestamp(now + datetime.timedelta(minutes=40)),
                       'privateRetentionDays': 7, 'auditEffectsAccounted': True},
        'qualification': {'classification': 'FROZEN_LOCAL_GATE', 'sourceSha256': sha,
                          'selectorSha256': MODULE.SELECTOR_SHA, 'head': 'a' * 40, 'tree': 'b' * 40,
                          'specReviewRef': 'SYNTHETIC_LOCAL_SPEC', 'standardsReviewRef': 'SYNTHETIC_LOCAL_STANDARDS',
                          'ciRef': 'SYNTHETIC_LOCAL_CI'},
        'reservation': {'classification': 'SSH_READ_RESERVED', 'allocationId': 'SYNTHETIC_LOCAL_ALLOCATION',
                        'runId': 'SYNTHETIC_LOCAL_RUN', 'sourceSha256': sha, 'selectorSha256': MODULE.SELECTOR_SHA,
                        'host': MODULE.HOST, 'user': MODULE.USER, 'port': 22, 'fingerprint': MODULE.FINGERPRINT,
                        'fingerprintVerified': True, 'inspectionStartedAt': timestamp(now - datetime.timedelta(seconds=1)),
                        'deadline': timestamp(now + datetime.timedelta(minutes=20)), 'reservedObservationIds': ids,
                        'privateCaptureReady': True},
    }


def metadata(name):
    return {'name': '/' + name, 'id': '1' * 64, 'image': MODULE.IMAGE, 'status': 'running',
            'startedAt': '2026-10-07T23:41:10Z', 'health': 'healthy', 'user': 'node',
            'readOnlyRoot': True, 'privileged': False, 'capDrop': ['ALL'], 'capAdd': [],
            'securityOpt': ['no-new-privileges:true'], 'restart': 'unless-stopped', 'mounts': [],
            'publishedPorts': {}, 'logDriver': 'json-file', 'canonicalRouteMatches': True,
            'canonicalRouteEnabled': True}


class Fixture:
    def __init__(self, root, scenario='normal'):
        self.root = root
        app = root / str(MODULE.APP).lstrip('/')
        app.mkdir(parents=True)
        compose, package = b'synthetic reviewed compose', b'synthetic reviewed archive'
        for name, data in [('compose.yaml', compose), ('reviewed-web-package.tar.gz', package),
                           ('.env', BAIT.encode()), ('runtime.env', BAIT.encode()), ('database.env', BAIT.encode())]:
            file = app / name
            file.write_bytes(data)
            file.chmod(0o600)
        proc = root / 'proc/7'
        proc.mkdir(parents=True)
        (proc / 'exe').symlink_to('/usr/local/bin/node')
        (proc / 'cgroup').write_text('0::/system.slice/example.service\n')
        self.script = root / 'fixed_command.py'
        data = {'normalRows': {name: metadata(name) for name in (MODULE.WEB, MODULE.DB, 'traefik', 'insignia-app')},
                'scenario': scenario, 'bait': BAIT}
        self.script.write_text('''import json,os,sys,time
DATA = json.loads(''' + repr(json.dumps(data)) + ''')
command = sys.argv[1:]
if any(key in os.environ for key in ('DOCKER_HOST','COMPOSE_FILE','NODE_OPTIONS','PGPASSWORD','SYNTHETIC_SECRET')):
    print(DATA['bait']); sys.exit(9)
if command[0] == 'docker' and command[-1].startswith('insignia-rewrite-m5-019-web'):
    scenario = DATA['scenario']
    if scenario == 'failure':
        sys.stdout.write(DATA['bait']); sys.stderr.write(DATA['bait']); sys.exit(17)
    if scenario == 'oversize':
        sys.stdout.write('x' * (1024 * 1024 + 1)); sys.exit()
    if scenario == 'timeout':
        time.sleep(2)
    if scenario == 'descendant':
        import subprocess
        subprocess.Popen([sys.executable,'-c','import time;time.sleep(2)'])
        sys.exit()
    if scenario == 'raw':
        print(json.dumps({'rawEnv':DATA['bait']})); sys.exit()
    if scenario == 'invalid_json':
        print('{"raw":"' + DATA['bait']); sys.exit()
    if scenario == 'duplicate_json':
        print('{"name":"safe","name":"' + DATA['bait'] + '"}'); sys.exit()
if command[0] == 'ps':
    print('7 1 node')
elif 'ps' in command:
    print(json.dumps({'id':'2'*64,'name':'synthetic-worker','image':'synthetic-worker:reviewed'}))
elif '.Config.Env' in command[-2]:
    if DATA['scenario'] == 'commercial_secret':
        print(json.dumps({'key':'INSIGNIA_PARTNER_ACCESS_TOKEN','value':DATA['bait']}))
    elif DATA['scenario'] == 'commercial_valid':
        policy = {'policyVersion':'synthetic-v1','maxAgeMs':30000,'plans':[{'planHandle':'synthetic-plan','usageHandle':'synthetic-usage','policyId':'synthetic-policy','features':['synthetic-base'],'includedUsage':0}]}
        features = {name:'synthetic-base' for name in ('base','required','logoLater','options','pricing')}
        for key,value in [('INSIGNIA_M5_ENTITLEMENT_POLICY_JSON',policy),('INSIGNIA_M5_FEATURES_JSON',features)]:
            print(json.dumps({'key':key,'value':json.dumps(value)}))
        print(json.dumps({'key':'INSIGNIA_PARTNER_ACCESS_TOKEN','present':True,'nonempty':True}))
    else:
        print(json.dumps({'key':'INSIGNIA_PARTNER_ACCESS_TOKEN','present':True,'nonempty':True}))
else:
    row = DATA['normalRows'][command[-1]]
    if DATA['scenario'] == 'image_drift' and command[-1].endswith('-web'):
        row['image'] = 'sha256:' + 'f' * 64
    if DATA['scenario'] == 'route_drift' and command[-1].endswith('-web'):
        row['canonicalRouteMatches'] = False
    print(json.dumps(row))
''')
        self.bindings = {'command': [sys.executable, '-B', str(self.script)], 'root': root,
                         'artifactHashes': [MODULE.digest(compose), MODULE.digest(package)]}

    def run(self, request=None):
        return MODULE.collect_local_test(request or envelope(), self.bindings)


class EntryControls(unittest.TestCase):
    def test_unqualified_entry_stops_before_any_host_read(self):
        result = subprocess.run([sys.executable, '-B', str(OPERATOR), 'collect'], input=b'{}', capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout)['classification'], 'STOP_ENTRY_UNQUALIFIED')
        self.assertEqual(result.stderr, b'')

    def test_local_subprocess_inventory_preserves_unknown_downstream(self):
        with tempfile.TemporaryDirectory() as directory:
            result = Fixture(Path(directory)).run()
            self.assertEqual(result['classification'], 'LOCAL_TEST_METADATA_OBSERVED_NATIVE_UNQUALIFIED')
            self.assertEqual(len(result['observations']), 12)
            self.assertEqual(result['observations'][-1]['classification'], 'UNKNOWN_NOT_ALLOCATED')
            self.assertFalse(result['globalAbsenceProven'])
            self.assertNotIn(BAIT, json.dumps(result))

    def test_live_cli_rejects_local_bindings_arbitrary_executables_paths_and_runtime(self):
        request = envelope()
        cases = [(['collect'], request), (['exec','/bin/sh'], {}), (['collect','--root','/etc'], {}),
                 (['collect','--command','docker exec'], {}), (['sql'], {}), (['describe'], {})]
        for argv, payload in cases:
            with self.subTest(argv=argv):
                result = subprocess.run([sys.executable, '-B', str(OPERATOR), *argv], input=json.dumps(payload).encode(), capture_output=True, timeout=5)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(json.loads(result.stdout)['attemptedObservationIds'], [])
                self.assertEqual(result.stderr, b'')

    def test_allocation_freeze_reservation_and_deadline_fail_before_read(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(Path(directory), 'failure')
            mutations = [('allocation','readOnly',False), ('allocation','host','outside.example'),
                         ('allocation','privateRetentionDays',8), ('qualification','sourceSha256','f'*64),
                         ('qualification','selectorSha256','f'*64), ('reservation','fingerprintVerified',False),
                         ('reservation','privateCaptureReady',False), ('reservation','reservedObservationIds',[]),
                         ('reservation','fingerprint','untrusted'), ('reservation','deadline','2000-01-01T00:00:00Z')]
            for section, key, value in mutations:
                request = envelope()
                request[section][key] = value
                result = fixture.run(request)
                self.assertTrue(result['classification'].startswith('STOP_'))
                self.assertEqual(result['attemptedObservationIds'], [])
            request = envelope()
            request['command'] = '/bin/sh'
            self.assertEqual(fixture.run(request)['attemptedObservationIds'], [])


class TransportControls(unittest.TestCase):
    def test_real_subprocess_failure_and_raw_metadata_never_capture_bait_or_retry(self):
        for scenario in ('failure','raw','invalid_json','duplicate_json','commercial_secret'):
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory() as directory:
                result = Fixture(Path(directory), scenario).run()
                self.assertTrue(result['classification'].startswith('STOP_'))
                self.assertNotIn(BAIT, json.dumps(result))
                self.assertFalse(result['retryAuthorized'])
                self.assertEqual(len(result['attemptedObservationIds']), len(set(result['attemptedObservationIds'])))

    def test_real_subprocess_stdout_limit_is_enforced_before_unbounded_capture(self):
        with tempfile.TemporaryDirectory() as directory:
            result = Fixture(Path(directory), 'oversize').run()
            self.assertEqual(result['classification'], 'STOP_OUTPUT_LIMIT')
            self.assertEqual(result['observations'], [])

    def test_real_subprocess_timeout_and_inherited_pipe_are_bounded(self):
        old = MODULE.COMMAND_SECONDS
        MODULE.COMMAND_SECONDS = 0.15
        try:
            for scenario in ('timeout','descendant'):
                with self.subTest(scenario=scenario), tempfile.TemporaryDirectory() as directory:
                    before = time.monotonic()
                    result = Fixture(Path(directory), scenario).run()
                    self.assertEqual(result['classification'], 'STOP_COMMAND_TIMEOUT')
                    self.assertLess(time.monotonic() - before, 1)
        finally:
            MODULE.COMMAND_SECONDS = old

    def test_process_environment_does_not_forward_secret_or_routing_overrides(self):
        keys = ('DOCKER_HOST','COMPOSE_FILE','NODE_OPTIONS','PGPASSWORD','SYNTHETIC_SECRET')
        saved = {key: os.environ.get(key) for key in keys}
        try:
            for key in keys:
                os.environ[key] = BAIT
            with tempfile.TemporaryDirectory() as directory:
                result = Fixture(Path(directory)).run()
                self.assertEqual(result['classification'], 'LOCAL_TEST_METADATA_OBSERVED_NATIVE_UNQUALIFIED')
                self.assertNotIn(BAIT, json.dumps(result))
        finally:
            for key,value in saved.items():
                if value is None:
                    os.environ.pop(key,None)
                else:
                    os.environ[key] = value

    def test_command_allowlist_blocks_sql_exec_shell_and_credentials(self):
        boundary = MODULE.Boundary(time.monotonic() + 1)
        for command in (('docker','exec',MODULE.WEB,'node'), ('psql','SELECT 1'), ('sh','-c','echo unsafe'),
                        ('curl','https://example.com'), ('docker','inspect',MODULE.WEB)):
            with self.subTest(command=command), self.assertRaises(MODULE.Stop) as stopped:
                boundary.command(command)
            self.assertEqual(stopped.exception.category, 'STOP_COMMAND_DENIED')

    def test_fixed_filesystem_boundary_denies_arbitrary_paths(self):
        boundary = MODULE.Boundary(time.monotonic() + 1)
        for path in (Path('/etc/shadow'), MODULE.APP / 'runtime.env/../compose.yaml', Path('/proc/7/environ'),
                     Path('/proc/7/cmdline'), MODULE.APP / 'worker.env'):
            with self.subTest(path=path), self.assertRaises(MODULE.Stop) as stopped:
                boundary.path(path)
            self.assertEqual(stopped.exception.category, 'STOP_PATH_DENIED')


class MetadataControls(unittest.TestCase):
    def test_running_topology_identifies_candidates_without_following_them(self):
        with tempfile.TemporaryDirectory() as directory:
            result = Fixture(Path(directory), 'processor_topology').run()
            self.assertEqual(result['classification'], 'LOCAL_TEST_METADATA_OBSERVED_NATIVE_UNQUALIFIED')
            topology = result['observations'][6]['metadata']
            self.assertEqual(topology['runningContainers'], [{'id':'2'*64,'name':'synthetic-worker','image':'synthetic-worker:reviewed'}])
            self.assertEqual(topology['processorCoverage'], 'UNKNOWN')
            self.assertFalse(topology['globalAbsenceProven'])
            self.assertEqual(result['attemptedObservationIds'].count('bounded-running-docker-topology'), 1)

    def test_nonsecret_commercial_values_do_not_claim_provider_truth(self):
        with tempfile.TemporaryDirectory() as directory:
            result = Fixture(Path(directory), 'commercial_valid').run()
            self.assertEqual(result['classification'], 'LOCAL_TEST_METADATA_OBSERVED_NATIVE_UNQUALIFIED')
            commercial = result['observations'][9]['metadata']
            self.assertEqual(commercial['policy']['plans'][0]['planHandle'], 'synthetic-plan')
            self.assertEqual(commercial['providerTruth'], 'UNKNOWN_NOT_QUERIED')
            self.assertEqual(commercial['presence']['INSIGNIA_PARTNER_ACCESS_TOKEN'], {'present':True,'nonempty':True})
            self.assertNotIn(BAIT, json.dumps(result))

    def test_artifact_and_route_drift_stop_followup_reads(self):
        for scenario, expected in [('image_drift','STOP_ARTIFACT_DRIFT'), ('route_drift','STOP_ROUTE_DRIFT')]:
            with tempfile.TemporaryDirectory() as directory:
                result = Fixture(Path(directory), scenario).run()
                self.assertEqual(result['classification'], expected)
                self.assertEqual(len(result['attemptedObservationIds']), 1)
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(Path(directory))
            app = fixture.root / str(MODULE.APP).lstrip('/')
            (app/'compose.yaml').write_text('drift')
            result = fixture.run()
            self.assertEqual(result['classification'], 'STOP_ARTIFACT_DRIFT')
            self.assertEqual(len(result['attemptedObservationIds']), 5)

    def test_symlink_artifact_is_not_followed(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(Path(directory))
            app = fixture.root / str(MODULE.APP).lstrip('/')
            (app/'compose.yaml').unlink()
            (app/'compose.yaml').symlink_to(app/'runtime.env')
            result = fixture.run()
            self.assertTrue(result['classification'].startswith('STOP_'))
            self.assertNotIn(BAIT, json.dumps(result))

    def test_missing_process_executable_is_unknown_not_absence(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(Path(directory))
            (fixture.root/'proc/7/exe').unlink()
            result = fixture.run()
            self.assertEqual(result['classification'], 'LOCAL_TEST_METADATA_OBSERVED_NATIVE_UNQUALIFIED')
            process = result['observations'][7]['metadata']['processes'][0]
            self.assertEqual(process['classification'], 'UNKNOWN_PROCESS_RACE_OR_ACCESS')
            self.assertFalse(result['globalAbsenceProven'])

    def test_ancestor_symlink_cannot_redirect_allocated_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(Path(directory))
            app = fixture.root / str(MODULE.APP).lstrip('/')
            alternate = fixture.root / 'outside-allocated-app'
            app.rename(alternate)
            app.symlink_to(alternate, target_is_directory=True)
            result = fixture.run()
            self.assertTrue(result['classification'].startswith('STOP_'))
            self.assertEqual(len(result['attemptedObservationIds']), 5)


class TemplateControls(unittest.TestCase):
    def test_real_local_go_templates_project_only_allocated_fields(self):
        go = shutil.which('go')
        self.assertIsNotNone(go, 'Local Go is required for this template control; never fetch it')
        policy = {'policyVersion':'synthetic-v1','maxAgeMs':30000,'plans':[]}
        features = {key:'synthetic-base' for key in ('base','required','logoLater','options','pricing')}
        fixture = {
            'Name':'/' + MODULE.WEB, 'Id':'1'*64, 'Image':MODULE.IMAGE,
            'ID':'2'*64, 'Names':'synthetic-worker',
            'State':{'Status':'running','StartedAt':'2026-10-07T23:41:10Z','Health':{'Status':'healthy','Log':[BAIT]}},
            'Config':{'User':'node','Cmd':[BAIT],'Entrypoint':[BAIT],'Labels':{
                'traefik.http.routers.insignia-canonical-m5-019r.rule':'Host(`insignia-app.optidigi.nl`)',
                'traefik.enable':'true','unallocated-label':BAIT},
                'Env':['SECRET_RAW='+BAIT,'INSIGNIA_PARTNER_ACCESS_TOKEN='+BAIT,'SHOPIFY_WEBHOOK_SECRET=',
                       MODULE.POLICY_KEYS[0]+'='+json.dumps(policy), MODULE.POLICY_KEYS[1]+'='+json.dumps(features)]},
            'HostConfig':{'ReadonlyRootfs':True,'Privileged':False,'CapDrop':['ALL'],'CapAdd':[],
                'SecurityOpt':['no-new-privileges:true'],'RestartPolicy':{'Name':'unless-stopped'},
                'PortBindings':{},'LogConfig':{'Type':'json-file','Config':{'token':BAIT}}}, 'Mounts':[],
        }
        with tempfile.TemporaryDirectory() as directory:
            environment = {**MODULE.ENVIRONMENT,'GOENV':'off','GOTOOLCHAIN':'local','GOPROXY':'off',
                           'GOSUMDB':'off','CGO_ENABLED':'0','GOCACHE':str(Path(directory)/'cache')}
            executable = Path(directory)/'template-control'
            compiled = subprocess.run([go,'build','-o',str(executable),str(OPERATOR.with_name('template_control.go'))],
                                      capture_output=True, timeout=60, env=environment)
            self.assertEqual(compiled.returncode,0, 'Local stdlib-only Go compilation must succeed')
            for template in (MODULE.CONTAINER_FORMAT,MODULE.COMMERCIAL_FORMAT,MODULE.TOPOLOGY_FORMAT):
                result = subprocess.run([str(executable)],input=json.dumps({'template':template,'metadata':fixture}).encode(),
                                        capture_output=True, timeout=5, env=MODULE.ENVIRONMENT)
                self.assertEqual(result.returncode,0)
                self.assertEqual(result.stderr,b'')
                self.assertNotIn(BAIT.encode(),result.stdout)
                if template == MODULE.CONTAINER_FORMAT:
                    self.assertEqual(MODULE.container(result.stdout,MODULE.WEB)['image'],MODULE.IMAGE)
                elif template == MODULE.TOPOLOGY_FORMAT:
                    self.assertEqual(json.loads(result.stdout), {'id':'2'*64,'name':'synthetic-worker','image':MODULE.IMAGE})
                else:
                    config = MODULE.nonsecret_configuration(result.stdout)
                    self.assertEqual(config['policy'],policy)
                    self.assertEqual(config['features'],features)
                    self.assertEqual(config['presence']['SHOPIFY_WEBHOOK_SECRET'],{'present':True,'nonempty':False})


if __name__ == '__main__':
    unittest.main()
