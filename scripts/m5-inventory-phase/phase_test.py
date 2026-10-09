"""Offline public phase/caller tests; no SSH/network or provider credentials."""
import datetime
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import subprocess
import unittest

SOURCE = Path(__file__).with_name('phase.py')
SPEC = importlib.util.spec_from_file_location('phase', SOURCE)
PHASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PHASE)

def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()

def digest(value):
    return hashlib.sha256(value).hexdigest()

def inputs(directory=None):
    now = datetime.datetime.now(datetime.timezone.utc)
    allocation = {'schema': 'insignia-inventory-phase-allocation-v1', 'mode': 'LOCAL_TEST',
                  'classification': 'OWNER_GRANTED_BOUNDED_READ_ONLY', 'ownerApprovalReference': 'SYNTHETIC_ONLY',
                  'privatePhaseDirectory': str(directory) if directory is not None else '/owner-private/SYNTHETIC_ONLY',
                  'expiresAt': (now + datetime.timedelta(minutes=40)).isoformat(),
                  'retentionDeleteBy': (now + datetime.timedelta(days=1)).isoformat(),
                  'retentionOwner': 'SYNTHETIC_ONLY', 'allowedMutations': [],
                  'ceilings': {'adminRequests': 3, 'ownerSurfaces': 3, 'metadataObservations': 12,
                               'bytesPerObservation': 1048576, 'activeSeconds': 1800},
                  'ownerSurfaceIds': ['active-config', 'app-wide-subscriptions', 'compliance-destinations']}
    qualification = {'classification': 'FROZEN_LOCAL_GATE', 'allocationSha256': digest(encoded(allocation)),
                     'phaseSourceSha256': digest(SOURCE.read_bytes()), 'head': 'a' * 40, 'tree': 'b' * 40,
                     'specReviewRef': 'SYNTHETIC_SPEC', 'standardsReviewRef': 'SYNTHETIC_STANDARDS', 'ciRef': 'SYNTHETIC_CI'}
    return allocation, qualification

IDS = ['canonical-web-runtime', 'canonical-database-runtime', 'canonical-router-runtime',
       'legacy-service-boundary', 'canonical-compose-artifact', 'reviewed-web-package-artifact',
       'bounded-running-docker-topology', 'bounded-host-process-executables', 'private-config-file-modes',
       'commercial-nonsecret-configuration']
UNKNOWN_IDS = ['current-queue-role-ownership', 'downstream-privacy-copy-ownership']

class HostFixture:
    def __init__(self, parent, scenario='normal', host_mutation=None, identity_name='private-identity'):
        self.directory = Path(parent)/'phase'
        self.source = Path(parent)/'frozen_host.py'
        self.key = Path(parent)/identity_name
        self.key.write_bytes(b'SYNTHETIC_PRIVATE_KEY_NEVER_READ')
        self.key.chmod(0o600)
        algorithm = b'ssh-ed25519'
        blob = len(algorithm).to_bytes(4,'big') + algorithm + (32).to_bytes(4,'big') + b'x'*32
        self.known_host = '65.109.22.104 ssh-ed25519 ' + base64.b64encode(blob).decode()
        fingerprint = 'SHA256:' + base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip('=')
        plan = [{'id': name, 'sources': [], 'selector': 'SYNTHETIC_ONLY'} for name in IDS+UNKNOWN_IDS]
        selector_sha = digest(encoded({'plan': plan, 'commands': []}))
        result = {'classification': 'METADATA_OBSERVED_NATIVE_UNQUALIFIED',
                  'attemptedObservationIds': IDS,
                  'observations': [{'id': name, 'classification': 'METADATA_OBSERVED_NATIVE_UNQUALIFIED',
                                    'metadata': {'privateFixture': 'SYNTHETIC_PRIVATE_METADATA'}} for name in IDS] +
                                  [{'id': name, 'classification': 'UNKNOWN_NOT_ALLOCATED'} for name in UNKNOWN_IDS],
                  'observationLimit': 12, 'providerRequests': 0, 'hostWrites': 0, 'productionSql': 0,
                  'globalAbsenceProven': False, 'retryAuthorized': False}
        self.source.write_text('import hashlib,json\nPLAN='+repr(plan)+'\nALLOWED_COMMANDS=()\n' +
            'SELECTOR_SHA='+repr(selector_sha)+'\n' +
            'def encoded(v): return json.dumps(v,sort_keys=True,separators=(\",\",\":\"),ensure_ascii=True).encode()\n' +
            'def collect_verified_source(request,source_bytes):\n' +
            ' assert hashlib.sha256(source_bytes).hexdigest()==request[\"qualification\"][\"sourceSha256\"]\n' +
            ' assert request[\"reservation\"][\"reservedObservationIds\"]=='+repr(IDS)+'\n' +
            ' return '+repr(result)+'\n')
        allocation, gate = inputs(self.directory)
        host_allocation = {'id': 'SYNTHETIC_HOST_ALLOCATION', 'host': '65.109.22.104', 'user': 'serveradmin', 'port': 22,
                           'readOnly': True, 'fingerprint': fingerprint, 'selectorSha256': selector_sha,
                           'observationIds': IDS, 'expiresAt': allocation['expiresAt'],
                           'privateRetentionDays': 1, 'auditEffectsAccounted': True}
        host_gate = {'classification': 'FROZEN_LOCAL_GATE', 'sourceSha256': digest(self.source.read_bytes()),
                     'selectorSha256': selector_sha, 'head': gate['head'], 'tree': gate['tree'],
                     'specReviewRef': gate['specReviewRef'], 'standardsReviewRef': gate['standardsReviewRef'], 'ciRef': gate['ciRef']}
        allocation['hostAllocation'] = host_allocation
        allocation['hostAccess'] = {'identityPath': str(self.key), 'knownHostLineSha256': digest(self.known_host.encode()),
                                    'forcedCommandSha256': digest(PHASE.frozen_remote_command(host_gate['sourceSha256']).encode()),
                                    'forcedCommandAttestationRef': 'SYNTHETIC_ACCESS_SETUP'}
        gate['hostQualification'] = host_gate
        if host_mutation is not None:
            host_mutation(host_allocation, host_gate, allocation['hostAccess'])
        gate['allocationSha256'] = digest(encoded(allocation))
        self.created = PHASE.create_phase(self.directory, allocation, gate)
        self.script = Path(parent)/'local_transport.py'
        self.script.write_text("import json,os,subprocess,sys,time\nfrom pathlib import Path\nstate=json.loads((Path(sys.argv[1])/'ledger.json').read_bytes())\nassert state['metadataObservations']==10 and state['host']['status']=='RESERVED'\nargv=sys.argv[2:]\nassert '-T' in argv and 'StrictHostKeyChecking=yes' in argv and 'IdentityAgent=none' in argv\nraw=sys.stdin.buffer.read()\nrequest=json.loads(raw)\nassert request['request']['reservation']['runId']==state['phaseId']\nassert b'SYNTHETIC_PRIVATE_KEY_NEVER_READ' not in raw\nprocess=subprocess.run(['/bin/sh','-c',argv[-1]],input=raw,capture_output=True,timeout=5)\nsys.stdout.buffer.write(process.stdout)\nsys.stderr.buffer.write(process.stderr)\nsys.exit(process.returncode)\n")
        self.command = [sys.executable, '-B', str(self.script), str(self.directory)]
    def run(self):
        return PHASE.run_host_inventory(self.directory, self.source, self.key, self.known_host, test_command=self.command)

class PhaseControls(unittest.TestCase):
    def test_one_phase_reserves_admin_once_with_same_shared_deadline_and_private_binding(self):
        with tempfile.TemporaryDirectory() as parent:
            directory = Path(parent) / 'phase'
            allocation, gate = inputs(directory)
            result = PHASE.create_phase(directory, allocation, gate)
            self.assertEqual(result['classification'], 'PHASE_CREATED_RESOURCES_UNQUALIFIED')
            self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o700)
            state = json.loads((directory / 'ledger.json').read_bytes())
            started = datetime.datetime.fromisoformat(state['startedAt'])
            deadline = datetime.datetime.fromisoformat(state['deadline'])
            self.assertEqual((deadline-started).total_seconds(), 1800)
            collector = {'schema': 'insignia-native-inventory-allocation-v1', 'privateEvidenceDirectory': str(directory/'admin'),
                         'validUntil': allocation['expiresAt'], 'ceilings': {'requests': 3, 'durationMs': 1800000}}
            reserved = PHASE.reserve_admin(directory, collector)
            self.assertEqual(reserved['classification'], 'ADMIN_REQUESTS_RESERVED_NOT_OBSERVED')
            binding = json.loads((directory / 'admin-binding.json').read_bytes())
            self.assertEqual(binding['collectorAllocation']['validUntil'], state['deadline'])
            self.assertEqual(binding['phaseAllocationSha256'], gate['allocationSha256'])
            self.assertEqual(binding['reservedRequests'], 3)
            self.assertEqual(json.loads((directory/'admin-allocation.json').read_bytes()), binding['collectorAllocation'])
            self.assertEqual(stat.S_IMODE((directory/'admin-binding.json').stat().st_mode), 0o600)
            self.assertEqual(PHASE.reserve_admin(directory, collector)['classification'], 'STOP_RESERVATION_CONSUMED')
            self.assertEqual(PHASE.create_phase(directory, allocation, gate)['classification'], 'STOP_PHASE_UNAVAILABLE')

    def test_unqualified_or_broadened_declarations_stop_before_phase_creation(self):
        mutations = [('allocation', 'classification', 'REQUEST_NOT_PERMISSION'),
                     ('allocation', 'allowedMutations', ['write']),
                     ('allocation', 'ownerApprovalReference', ''),
                     ('qualification', 'classification', 'NOT_REVIEWED'),
                     ('qualification', 'phaseSourceSha256', 'f'*64),
                     ('qualification', 'ciRef', '')]
        for section, key, value in mutations:
            with self.subTest(key=key), tempfile.TemporaryDirectory() as parent:
                allocation, gate = inputs()
                (allocation if section == 'allocation' else gate)[key] = value
                directory = Path(parent)/'phase'
                self.assertEqual(PHASE.create_phase(directory, allocation, gate)['classification'], 'STOP_PHASE_UNQUALIFIED')
                self.assertFalse(directory.exists())
        with tempfile.TemporaryDirectory() as parent:
            allocation, gate = inputs()
            allocation['ceilings']['metadataObservations'] = 13
            gate['allocationSha256'] = digest(encoded(allocation))
            directory = Path(parent)/'phase'
            self.assertEqual(PHASE.create_phase(directory, allocation, gate)['classification'], 'STOP_PHASE_UNQUALIFIED')
            self.assertFalse(directory.exists())

    def test_manual_surfaces_are_reserved_before_read_once_and_closure_is_final(self):
        with tempfile.TemporaryDirectory() as parent:
            directory = Path(parent)/'phase'
            allocation, gate = inputs(directory)
            PHASE.create_phase(directory, allocation, gate)
            for surface in allocation['ownerSurfaceIds']:
                result = PHASE.reserve_owner_surface(directory, surface)
                self.assertEqual(result['classification'], 'OWNER_SURFACE_RESERVED_NOT_OBSERVED')
            state = json.loads((directory/'ledger.json').read_bytes())
            self.assertEqual(len(state['ownerSurfaces']), 3)
            self.assertTrue(all(row['status'] == 'RESERVED_NOT_OBSERVED' for row in state['ownerSurfaces']))
            self.assertEqual(PHASE.reserve_owner_surface(directory, 'active-config')['classification'], 'STOP_RESERVATION_CONSUMED')
            self.assertEqual(PHASE.reserve_owner_surface(directory, 'unallocated-page')['classification'], 'STOP_SURFACE_UNALLOCATED')
            self.assertEqual(PHASE.close_phase(directory)['classification'], 'PHASE_CLOSED_RESERVATIONS_NOT_PROOF')
            self.assertEqual(PHASE.reserve_owner_surface(directory, 'active-config')['classification'], 'STOP_PHASE_CLOSED')
            self.assertEqual(PHASE.close_phase(directory)['classification'], 'STOP_PHASE_CLOSED')

    def test_real_local_pipe_loader_verifies_exact_bytes_and_host_reservation_before_transport(self):
        with tempfile.TemporaryDirectory() as parent:
            fixture = HostFixture(parent)
            result = fixture.run()
            self.assertEqual(result['classification'], 'HOST_METADATA_CAPTURED_NATIVE_UNQUALIFIED')
            self.assertEqual(result['reservedMetadataObservations'], 10)
            self.assertNotIn('SYNTHETIC_PRIVATE_METADATA', json.dumps(result))
            state = json.loads((fixture.directory/'ledger.json').read_bytes())
            self.assertEqual(state['host']['status'], 'CAPTURED_NATIVE_UNQUALIFIED')
            self.assertEqual(state['host']['attemptedObservationIds'], IDS)
            self.assertEqual(stat.S_IMODE((fixture.directory/'host-stdout.private').stat().st_mode), 0o600)
            capture = json.loads((fixture.directory/'host-stdout.private').read_bytes())
            self.assertEqual(len(capture['observations']), 12)
            self.assertEqual(fixture.run()['classification'], 'STOP_RESERVATION_CONSUMED')

    def test_failed_subprocess_streams_are_bounded_private_consumed_and_close_the_phase(self):
        scenarios = {
            'failure': "import sys;sys.stdout.write('SYNTHETIC_PRIVATE_METADATA');sys.stderr.write('PRIVATE_SSH_ERROR');sys.exit(7)",
            'stdout_limit': "import sys;sys.stdout.write('x'*(12*1048576+65537))",
            'stderr_limit': "import sys;sys.stderr.write('x'*65537)",
            'malformed': "import sys;sys.stdout.write('{private-invalid-json')",
            'timeout': "import time;time.sleep(2)",
        }
        for scenario, code in scenarios.items():
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory() as parent:
                fixture = HostFixture(parent)
                fixture.script.write_text(code)
                if scenario == 'timeout':
                    state = json.loads((fixture.directory/'ledger.json').read_bytes())
                    state['deadline'] = (datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(seconds=.15)).isoformat()
                    (fixture.directory/'ledger.json').write_bytes(encoded(state))
                result = fixture.run()
                self.assertTrue(result['classification'].startswith('STOP_'))
                self.assertNotIn('SYNTHETIC_PRIVATE_METADATA', json.dumps(result))
                self.assertNotIn('PRIVATE_SSH_ERROR', json.dumps(result))
                state = json.loads((fixture.directory/'ledger.json').read_bytes())
                self.assertTrue(state['closed'])
                self.assertEqual(state['host']['status'], 'UNCERTAIN_NO_RETRY')
                size = sum((fixture.directory/name).stat().st_size for name in ('host-stdout.private','host-stderr.private'))
                self.assertLessEqual(size, 12*1048576+65536)
                self.assertLessEqual((fixture.directory/'host-stderr.private').stat().st_size, 65536)
                self.assertEqual(fixture.run()['classification'], 'STOP_PHASE_CLOSED')

    def test_same_allocation_cannot_restart_budget_at_another_directory(self):
        with tempfile.TemporaryDirectory() as parent:
            directory = Path(parent)/'phase'
            allocation, gate = inputs(directory)
            self.assertEqual(PHASE.create_phase(directory, allocation, gate)['classification'], 'PHASE_CREATED_RESOURCES_UNQUALIFIED')
            other = Path(parent)/'retry'
            self.assertEqual(PHASE.create_phase(other, allocation, gate)['classification'], 'STOP_PHASE_UNQUALIFIED')
            self.assertFalse(other.exists())

    def test_remote_result_cannot_claim_complete_when_shape_or_accounting_is_inconsistent(self):
        changes = ["result['providerRequests']=1", "result['globalAbsenceProven']=True",
                   "result['attemptedObservationIds']=[]", "result['observations']=[]",
                   "result['observations'][0]['id']='unallocated'", "result['retryAuthorized']=True"]
        for change in changes:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as parent:
                fixture = HostFixture(parent)
                script = fixture.script.read_text().replace('sys.stdout.buffer.write(process.stdout)',
                    'result=json.loads(process.stdout)\n'+change+'\nsys.stdout.buffer.write(json.dumps(result).encode())')
                fixture.script.write_text(script)
                result = fixture.run()
                self.assertEqual(result['classification'], 'STOP_HOST_RESULT_INVALID')
                state = json.loads((fixture.directory/'ledger.json').read_bytes())
                self.assertTrue(state['closed'])
                self.assertEqual(state['metadataObservations'], 10)

    def test_invalid_host_gate_or_access_never_invokes_transport_or_reserves_reads(self):
        mutations = [lambda a,g,k: g.update(ciRef=''), lambda a,g,k: g.update(head='not-a-head'),
                     lambda a,g,k: a.update(privateRetentionDays=8), lambda a,g,k: a.update(extra='unallocated'),
                     lambda a,g,k: k.update(forcedCommandAttestationRef='')]
        for mutate in mutations:
            with self.subTest(mutate=mutate.__code__.co_firstlineno), tempfile.TemporaryDirectory() as parent:
                fixture = HostFixture(parent, host_mutation=mutate)
                marker = Path(parent)/'transport-invoked'
                fixture.script.write_text('from pathlib import Path;Path('+repr(str(marker))+').write_text("bad")')
                result = fixture.run()
                self.assertTrue(result['classification'].startswith('STOP_'))
                self.assertFalse(marker.exists())
                state = json.loads((fixture.directory/'ledger.json').read_bytes())
                self.assertEqual(state['metadataObservations'], 0)

    def test_frozen_command_is_single_line_for_restrict_command_access_setup(self):
        command = PHASE.frozen_remote_command('a'*64)
        self.assertNotIn('\n', command)
        self.assertNotIn('\r', command)
        self.assertIn('a'*64, command)
        self.assertIn('/usr/bin/python3 -I -B -c', command)

    def test_remote_loader_rejects_changed_source_even_if_stdin_digest_claims_are_updated(self):
        with tempfile.TemporaryDirectory() as parent:
            fixture = HostFixture(parent)
            original = fixture.script.read_text()
            marker = Path(parent)/'unapproved-executed'
            inserted = ("envelope=json.loads(raw)\nimport base64,hashlib\n"
                        "modified=base64.b64decode(envelope['source'])+"+repr(("\nopen("+repr(str(marker)) + ",'w').write('bad')\n").encode())+"\n"
                        "envelope['source']=base64.b64encode(modified).decode()\n"
                        "envelope['request']['qualification']['sourceSha256']=hashlib.sha256(modified).hexdigest()\n"
                        "envelope['request']['reservation']['sourceSha256']=hashlib.sha256(modified).hexdigest()\n"
                        "raw=json.dumps(envelope).encode()\n")
            fixture.script.write_text(original.replace("process=subprocess.run", inserted+"process=subprocess.run"))
            self.assertEqual(fixture.run()['classification'], 'STOP_SSH_OR_REMOTE_FAILURE')
            self.assertFalse(marker.exists())
            self.assertTrue(json.loads((fixture.directory/'ledger.json').read_bytes())['closed'])

    def test_killed_caller_reservation_is_consumed_without_any_resume(self):
        with tempfile.TemporaryDirectory() as parent:
            fixture = HostFixture(parent)
            fixture.script.write_text('import os,signal;os.kill(os.getppid(),signal.SIGKILL)')
            bridge = Path(parent)/'local_bridge.py'
            bridge.write_text("import importlib.util,sys\nspec=importlib.util.spec_from_file_location('phase',sys.argv[1]);p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)\n"
                              "p.run_host_inventory(sys.argv[2],sys.argv[3],sys.argv[4],sys.argv[5],test_command=[sys.executable,'-B',sys.argv[6],sys.argv[2]])\n")
            result = subprocess.run([sys.executable,'-B',str(bridge),str(SOURCE),str(fixture.directory),str(fixture.source),
                                     str(fixture.key),fixture.known_host,str(fixture.script)], capture_output=True, timeout=5)
            self.assertEqual(result.returncode, -9)
            state = json.loads((fixture.directory/'ledger.json').read_bytes())
            self.assertEqual(state['metadataObservations'], 10)
            self.assertEqual(state['host']['status'], 'RESERVED')
            self.assertEqual(fixture.run()['classification'], 'STOP_RESERVATION_CONSUMED')
            self.assertEqual(PHASE.close_phase(fixture.directory)['classification'], 'PHASE_CLOSED_RESERVATIONS_NOT_PROOF')

    def test_identity_expansion_syntax_stops_before_reservation_or_transport(self):
        for name in ['identity-%h', 'identity-%d', 'identity-${HOME}']:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as parent:
                fixture = HostFixture(parent, identity_name=name)
                marker = Path(parent)/'transport-started'
                fixture.script.write_text('from pathlib import Path\nPath('+repr(str(marker))+').touch()\n'+fixture.script.read_text())
                result = fixture.run()
                self.assertEqual(result['classification'], 'STOP_KEY_METADATA')
                self.assertFalse(marker.exists())
                state = json.loads((fixture.directory/'ledger.json').read_bytes())
                self.assertEqual(state['metadataObservations'], 0)
                self.assertIsNone(state['host'])

    def test_cli_rejects_unsupported_operation_without_echoing_private_arguments(self):
        result = subprocess.run([sys.executable,'-B',str(SOURCE),'arbitrary-command','SYNTHETIC_PRIVATE_ARGUMENT'],capture_output=True,timeout=5)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout)['classification'], 'STOP_PHASE_UNQUALIFIED')
        self.assertNotIn(b'SYNTHETIC_PRIVATE_ARGUMENT', result.stdout)
        self.assertEqual(result.stderr, b'')

if __name__ == '__main__':
    unittest.main(verbosity=2)
