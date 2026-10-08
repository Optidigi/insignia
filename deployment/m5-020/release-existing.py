"""Release one existing canonical version after a complete fresh frozen gate.

No creation/build/deploy, automatic rollback, fixture or retry path exists here.
CLI credentials use the existing owner HOME; this is not credential isolation.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tomllib

ROOT = Path('/home/serveradmin/insignia-m5-020-worktree')
NEUTRAL = Path('/home/serveradmin/insignia-m5-020-handoff')
RUN = NEUTRAL / 'run'
NODE = Path('/home/serveradmin/.local/opt/node-v24.21.0-linux-x64/bin/node')
CLI_ROOT = NEUTRAL / 'cli-4.8.2/package'
CLI = CLI_ROOT / 'bin/run.js'
CONTEXT = NEUTRAL / 'read-context'
TAG = 'm5-019r-9b94149272d1'
WORKFLOWS = {'M1-001 foundation and boundaries', 'M0-010 local hybrid billing proof',
             'M0-012 real contract local prototype', 'M0-011 local provider adapter boundary',
             'M0-009 embedded Astro local proof', 'M0-008 local publication and architecture checks',
             'M3-001 PostgreSQL durable core', 'M0-014 local public-app candidate',
             'M3-002 local runtime and ingress', 'M0-013 off-store protocol capacity'}


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def environment():
    require(os.environ.get('HOME') == '/home/serveradmin', 'owner_home_changed')
    return {'HOME': '/home/serveradmin', 'PATH': str(NODE.parent) + ':/usr/bin:/bin', 'CI': '1',
            'SHOPIFY_CLI_NO_ANALYTICS': '1', 'SHOPIFY_CLI_NO_UPDATE_NOTIFIER': '1', 'NO_COLOR': '1',
            'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1'}


def git(*args):
    return subprocess.check_output(['/usr/bin/git', '-c', 'core.fsmonitor=false',
        '-c', 'core.hooksPath=/dev/null', '-c', 'core.untrackedCache=false', '-C', str(ROOT), *args],
        env=environment(), text=True).strip()


def digest(path):
    return hashlib.sha256(os.fsencode(os.readlink(path)) if path.is_symlink() else path.read_bytes()).hexdigest()


def expected_versions():
    return [{'versionId': 'gid://shopify/Version/' + version, 'status': status, 'versionTag': tag}
            for version, status, tag in [('1158986629121', 'inactive', TAG),
            ('1153019904001', 'active', 'insignia-3'),
            ('1158837927937', 'inactive', 'm5-019-a9717e1265ef'),
            ('1152880803841', 'inactive', 'insignia-2'),
            ('1146748534785', 'inactive', 'insignia-1')]]


def validate_versions(rows):
    require(len(rows) == 5 and len({r['versionId'] for r in rows}) == 5, 'version_set_changed')
    require({(r['versionId'], r['status'], r['versionTag']) for r in rows} ==
            {(r['versionId'], r['status'], r['versionTag']) for r in expected_versions()}, 'version_state_changed')


def required_files(reviews):
    paths = {ROOT / p for p in git('ls-files', '-z').split('\0') if p and (ROOT / p).is_file()}
    accepted = json.loads((ROOT / 'docs/delivery/evidence/m5-018/freeze-round4-inventory.json').read_text())
    rows = accepted['source'] + accepted['build']
    require(len(rows) == 621, 'accepted_inventory_count')
    for row in rows:
        path = ROOT / row['path']
        require(digest(path) == row['sha256'], 'accepted_source_build_changed')
        paths.add(path)
    for root in [CLI_ROOT, NEUTRAL / 'cli-runtime-dependencies', CONTEXT]:
        require(root.is_dir() and not root.is_symlink(), 'input_root_changed')
        paths.update(p for p in root.rglob('*') if p.is_file() or p.is_symlink())
    paths.update([NODE, Path('/usr/bin/git')])
    for r in reviews:
        paths.update([Path(r['report']), Path(r['settings'])])
    paths.update(NEUTRAL / s for s in ['versions-prestate.json', 'canonical-public-host.json',
                 'fresh-native-readback.json', 'pre-release-ci.json', 'release-controls-green.log', 'release-controls.json',
                 'pre-release-review-bindings.json'])
    return paths


def validate_context():
    configuration = ROOT / 'deployment/m5-019r'
    app_file = CONTEXT / 'shopify.app.m5-019r.toml'
    require(app_file.read_bytes() == (configuration / app_file.name).read_bytes(), 'context_app_config_drift')
    app = tomllib.loads(app_file.read_text())
    require(app['client_id'] == '1443cf6d03d39edae7c101a943c5c684' and app['name'] == 'Insignia'
            and app['application_url'] == 'https://insignia-app.optidigi.nl/admin/products'
            and app['embedded'] is True and app['webhooks']['api_version'] == '2026-07', 'canonical_context_identity')
    require(app['access_scopes'] == {'scopes': '', 'optional_scopes': ['write_products', 'read_publications',
            'read_product_listings'], 'use_legacy_install_flow': False} and app['auth'] == {'redirect_urls': []},
            'context_scope_flags_or_redirect_drift')
    bindings = json.loads((configuration / 'extension-bindings.json').read_text())
    require(len(bindings) == 2, 'context_function_count')
    for binding, name in zip(bindings, ['insignia-cart-transform', 'insignia-cart-validation'], strict=True):
        target = CONTEXT / 'extensions' / name
        module_file = target / 'shopify.extension.toml'
        require(module_file.read_bytes() == (configuration / 'extensions' / name / module_file.name).read_bytes(),
                'context_function_config_drift')
        module = tomllib.loads(module_file.read_text())['extensions'][0]
        require(module['uid'] == binding['proposedLocalUid'] and module['handle'] == binding['handle'], 'context_function_uid_drift')
        require(digest(target / module['build']['path']) == binding['wasmSha256'], 'context_wasm_drift')
        for name, sha256 in binding['sourceQuerySha256'].items():
            require(digest(target / 'src' / name) == sha256, 'context_query_drift')
    envelope = json.loads((ROOT / 'docs/delivery/evidence/m5-019/cli-launch-envelope.json').read_text())
    for row in envelope['sourceFiles']:
        relative = row['path'].split('/@shopify/cli/', 1)[1]
        path = CLI_ROOT / relative
        require(not path.is_symlink() and digest(path) == row['sha256'], 'accepted_cli_anchor_drift')


def validate_gate(path):
    require(path == NEUTRAL / 'pre-release-gate.json' and not path.is_symlink(), 'gate_path_binding')
    return validate_gate_data(json.loads(path.read_text()))


def validate_gate_data(g):
    require(isinstance(g, dict) and {'slice', 'frozen', 'releaseCeiling', 'versionCreationCeiling', 'versionId',
            'versionTag', 'sourceHead', 'sourceTree', 'gitDirectory', 'reviews', 'files'} <= set(g), 'gate_fields_incomplete')
    require(digest(Path('/usr/bin/git')) == '5516c9f362c29376ab9a499a33082f9f611941d8c75930c880e30ad109e39c9a'
            and digest(NODE) == '7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c', 'accepted_git_node_anchor_drift')
    validate_context()
    require(g['slice'] == 'M5-020' and g['frozen'] is True and g['releaseCeiling'] == 1
            and g['versionCreationCeiling'] == 0, 'gate_authority')
    require(g['versionId'] == '1158986629121' and g['versionTag'] == TAG, 'exact_existing_candidate')
    require(git('rev-parse', '--show-toplevel') == str(ROOT) and git('rev-parse', 'HEAD') == g['sourceHead']
            and git('rev-parse', '--absolute-git-dir') == g['gitDirectory']
            and git('rev-parse', 'HEAD^{tree}') == g['sourceTree'] and not git('status', '--porcelain'),
            'source_context_or_cleanliness_changed')
    validate_versions(json.loads((NEUTRAL / 'versions-prestate.json').read_text()))
    native = json.loads((NEUTRAL / 'fresh-native-readback.json').read_text())
    require(native['classification'] == 'FRESH_NATIVE_VERSION_CONFIG_AND_INSTALLATION_CONFIRMED',
            'fresh_native_readback_missing')
    prior = json.loads((ROOT / 'docs/delivery/evidence/m5-019r/owner-native-attestation.json').read_text())
    require(native['nativeVersionPageReadback'] == prior['nativeVersionPageReadback'], 'native_candidate_config_drift')
    require(native['designatedInstallationClassification'] == 'DESIGNATED_INSTALLATION_PRESENCE_CONFIRMED_BY_OWNER'
            and native['inactiveCandidate'] is True and native['candidateVersionEqualityClaim'] is False,
            'fresh_installation_or_inactive_evidence_missing')
    public = json.loads((NEUTRAL / 'canonical-public-host.json').read_text())
    old = json.loads((ROOT / 'docs/delivery/evidence/m5-019r/host-routing-qualification.json').read_text())
    require(public['canonicalOrigin'] == 'https://insignia-app.optidigi.nl', 'canonical_host_drift')
    require([(r['path'], r['status'], r['bodySha256'], r['cacheControl'], r['csp']) for r in public['rows']] ==
            [(r['path'], r['status'], r['bodySha256'], r['cacheControl'], r['csp']) for r in old['publicRoutes']],
            'host_response_or_artifact_drift')
    ci = json.loads((NEUTRAL / 'pre-release-ci.json').read_text())
    require(len(ci) == 10 and {r['name'] for r in ci} == WORKFLOWS
            and len({r['databaseId'] for r in ci}) == 10, 'ci_set_incomplete')
    require(all(r['headSha'] == g['sourceHead'] and r['attempt'] == 1 and r['status'] == 'completed'
                and r['conclusion'] == 'success'
                and r['url'] == 'https://github.com/Optidigi/insignia/actions/runs/' + str(r['databaseId'])
                for r in ci), 'ci_not_exact_source_attempt_one_success')
    controls = json.loads((NEUTRAL / 'release-controls.json').read_text())
    require(controls['exitCode'] == 0 and controls['tests'] == 8
            and controls['operatorSha256'] == digest(ROOT / 'deployment/m5-020/release-existing.py')
            and controls['testSha256'] == digest(ROOT / 'deployment/m5-020/release-existing.test.py')
            and controls['logSha256'] == digest(NEUTRAL / 'release-controls-green.log'), 'offline_release_controls_not_bound')
    reviews = g['reviews']
    require(reviews == json.loads((NEUTRAL / 'pre-release-review-bindings.json').read_text()), 'review_pointer_drift')
    require(len(reviews) == 2 and {r['axis'] for r in reviews} == {'spec', 'security'}, 'review_axes')
    require(len({r['report'] for r in reviews}) == len({r['settings'] for r in reviews}) == 2, 'review_file_duplicate')
    sessions = []
    for r in reviews:
        report, settings = Path(r['report']), Path(r['settings'])
        require(report.parent == settings.parent == NEUTRAL, 'review_path_binding')
        s = json.loads(settings.read_text());text = report.read_text()
        require(s['head'] == g['sourceHead'] and s['verdict'] == 'CLEAR'
                and text.lstrip().startswith('CLEAR') and g['sourceHead'] in text
                and digest(report) == s['reportSha256'], 'review_report_binding')
        require(s['actualTurnContexts'] and all(c['model'] == 'gpt-6.1-sol' and c['effort'] == 'high'
                and c['approval_policy'] == 'never' and c['sandbox_policy']['type'] == 'read-only'
                for c in s['actualTurnContexts']), 'review_actual_runtime')
        sessions.append(s['session'])
    require(len(set(sessions)) == 2, 'review_session_duplicate')
    rows = g['files'];paths = [Path(r['path']) for r in rows]
    require(len(set(paths)) == len(paths) and set(paths) == required_files(reviews), 'frozen_inventory_incomplete')
    for p, r in zip(paths, rows, strict=True):
        require(r['kind'] == ('symlink' if p.is_symlink() else 'file') and digest(p) == r['sha256'],
                'frozen_input_changed')
        if p.is_symlink():
            require(p.resolve().is_relative_to(ROOT) or p.resolve().is_relative_to(NEUTRAL), 'input_symlink_escape')
    require(json.loads((CLI_ROOT / 'package.json').read_text())['version'] == '4.8.2', 'cli_pin')
    require(subprocess.check_output([str(NODE), '--version'], env=environment(), text=True).strip() == 'v24.21.0', 'node_pin')
    require(not Path('/home/serveradmin/.local/share/@shopify/cli/package.json').exists(), 'external_cli_plugin_registry')
    return g


def durable_new(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(data, f, indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)


def release_existing(gate_path):
    gate = validate_gate(gate_path)
    RUN.mkdir(mode=0o700, exist_ok=True)
    require(not RUN.is_symlink() and RUN.stat().st_uid == os.getuid() and RUN.stat().st_mode & 0o777 == 0o700,
            'run_owner_or_permissions')
    fd = os.open(RUN.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)
    durable_new(RUN / 'release-reservation.json', {'sourceHead': gate['sourceHead'],
        'gateSha256': digest(gate_path), 'attempt': 1, 'ceiling': 1, 'versionId': '1158986629121',
        'versionTag': TAG, 'versionCreationAttempts': 0})
    arguments = [str(NODE), str(CLI), 'app', 'release', '--path', str(CONTEXT), '--config', 'm5-019r',
                 '--version', TAG, '--allow-updates', '--no-color']
    with (RUN / 'cli-output.private.log').open('x') as log:
        os.chmod(log.name, 0o600)
        process = subprocess.Popen(arguments, cwd=CONTEXT, env=environment(), stdin=subprocess.DEVNULL,
                                   stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = process.wait(timeout=180)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGTERM)
            try:process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL);process.wait()
            code = None
    output = re.sub(r'\s+', ' ', (RUN / 'cli-output.private.log').read_text())
    ack = code == 0 and 'Version released to users.' in output and TAG in output
    result = {'releaseAttempts': 1, 'versionCreationAttempts': 0, 'exitCode': code,
              'outcome': 'CLI_ACK_READBACK_REQUIRED' if ack else 'AMBIGUOUS_STOP_NO_RETRY'}
    durable_new(RUN / 'dispatch-result.json', result)
    return result


if __name__ == '__main__':
    require(len(sys.argv) == 2, 'fixed_gate_required')
    print(json.dumps(release_existing(Path(sys.argv[1]))))
