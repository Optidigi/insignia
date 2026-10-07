"""One-shot, no-build/no-release CLI dispatch after the frozen M5-019 gate."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tomllib

NEUTRAL = Path('/home/serveradmin/insignia-m5-019-handoff')
WORKTREE = Path('/home/serveradmin/insignia-m5-019-worktree')
CANONICAL = NEUTRAL / 'version-run'
NODE = Path('/home/serveradmin/.local/opt/node-v24.21.0-linux-x64/bin/node')
CLI = Path('/home/serveradmin/insignia-pf001-tools/shopify/node_modules/@shopify/cli/bin/run.js')
WORKFLOWS = {
    'M1-001 foundation and boundaries', 'M0-010 local hybrid billing proof',
    'M0-012 real contract local prototype', 'M0-011 local provider adapter boundary',
    'M0-009 embedded Astro local proof', 'M0-008 local publication and architecture checks',
    'M3-001 PostgreSQL durable core', 'M0-014 local public-app candidate',
    'M3-002 local runtime and ingress', 'M0-013 off-store protocol capacity',
}


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def durable_new(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as file:
        json.dump(value, file, indent=2)
        file.write('\n')
        file.flush()
        os.fsync(file.fileno())
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def validate_ci(rows, head):
    require(len(rows) == 10 and {row['name'] for row in rows} == WORKFLOWS,
            'ci_workflow_set_incomplete_or_duplicate')
    require(len({row['databaseId'] for row in rows}) == 10, 'ci_run_id_duplicate')
    for row in rows:
        require(row['headSha'] == head and row['attempt'] == 1
                and row['status'] == 'completed' and row['conclusion'] == 'success',
                'ci_not_exact_head_attempt_one_success')
        require(row['url'] == 'https://github.com/Optidigi/insignia/actions/runs/' + str(row['databaseId']),
                'ci_repository_or_run_binding')


def validate_candidate(source, candidate):
    require(candidate == NEUTRAL / 'app-version-qualified', 'candidate_directory_binding')
    require(not candidate.is_symlink(), 'candidate_symlink')
    configuration = source / 'deployment/m5-019'
    app_file = candidate / 'shopify.app.m5-019.toml'
    require(app_file.read_bytes() == (configuration / app_file.name).read_bytes(), 'app_config_changed')
    require(tomllib.loads(app_file.read_text())['client_id'] == '1443cf6d03d39edae7c101a943c5c684',
            'exact_client_binding')
    bindings = json.loads((configuration / 'extension-bindings.json').read_text())
    require(len(bindings) == 2, 'function_count')
    expected = {app_file}
    for binding, name in zip(bindings, ['insignia-cart-transform', 'insignia-cart-validation'], strict=True):
        target = candidate / 'extensions' / name
        module_file = target / 'shopify.extension.toml'
        require(module_file.read_bytes() == (configuration / 'extensions' / name / module_file.name).read_bytes(),
                'function_config_changed')
        module = tomllib.loads(module_file.read_text())['extensions'][0]
        require(module['uid'] == binding['proposedLocalUid'] and module['handle'] == binding['handle'],
                'function_identity_changed')
        require(module['build']['command'] == 'exit 1' and module['build']['wasm_opt'] is False,
                'function_rebuild_enabled')
        wasm = target / module['build']['path']
        require(digest(wasm) == binding['wasmSha256'], 'function_wasm_changed')
        expected.update([module_file, wasm])
        for name, sha256 in binding['sourceQuerySha256'].items():
            query = target / 'src' / name
            require(digest(query) == sha256, 'function_query_changed')
            expected.add(query)
    entries = list(candidate.rglob('*'))
    require(not any(path.is_symlink() for path in entries), 'candidate_path_escape')
    require({path for path in entries if path.is_file()} == expected, 'candidate_file_set_changed')
    require(all(path.resolve().is_relative_to(candidate) for path in expected), 'candidate_path_escape')
    return expected


def mandatory_files(source, candidate_files, reviews):
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=source).decode().split('\0')
    paths = {source / path for path in tracked if path}
    baseline = json.loads((source / 'docs/delivery/evidence/m5-018/freeze-round4-inventory.json').read_text())
    accepted = baseline['source'] + baseline['build']
    require(len(accepted) == 621, 'accepted_inventory_count')
    for row in accepted:
        path = source / row['path']
        require(digest(path) == row['sha256'], 'accepted_source_or_build_changed')
        paths.add(path)
    envelope = json.loads((source / 'docs/delivery/evidence/m5-019/cli-launch-envelope.json').read_text())
    for row in envelope['sourceFiles']:
        path = Path(row['path'])
        require(digest(path) == row['sha256'], 'pinned_cli_source_changed')
        paths.add(path)
    paths.update(candidate_files)
    paths.add(NODE)
    for review in reviews:
        paths.update([Path(review['settings']), Path(review['report'])])
    paths.update(NEUTRAL / name for name in ['preversion-ci.json', 'versions-pre-freeze.json', 'reservation-control.json'])
    return {path.resolve() for path in paths}


def validate_files(rows, required):
    paths = [Path(row['path']).resolve() for row in rows]
    require(len(paths) == len(set(paths)), 'frozen_inventory_duplicate')
    require(set(paths) == required, 'frozen_inventory_incomplete_or_extra')
    for path, row in zip(paths, rows, strict=True):
        require(digest(path) == row['sha256'], 'frozen_file_changed')


def validate_gate(gate_path):
    gate = json.loads(gate_path.read_text())
    require(gate['slice'] == 'M5-019' and gate['frozen'] is True, 'gate_not_frozen')
    source = Path(gate['worktree']).resolve()
    require(source == WORKTREE, 'worktree_binding')
    require(gate['versionTag'] == 'm5-019-' + gate['sourceHead'][:12], 'version_tag_binding')
    require(subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip() == gate['sourceHead'],
            'reviewed_head_changed')
    require(not subprocess.check_output(['git', 'status', '--porcelain'], cwd=source, text=True), 'worktree_dirty')
    host = json.loads((source / 'docs/delivery/evidence/m5-019/host-routing-qualification.json').read_text())
    require(gate['hostClassification'] == host['classification'] == 'HOST_WEB_READINESS_PASS', 'host_not_ready')
    versions = json.loads((NEUTRAL / 'versions-pre-freeze.json').read_text())
    require(gate['activeVersion'] == '1153019904001'
            and [row['versionId'] for row in versions if row['status'] == 'active'] == ['gid://shopify/Version/1153019904001'],
            'active_version_prestate_mismatch')
    reviews = gate['reviews']
    require(len(reviews) == 2 and {row['axis'] for row in reviews} == {'spec', 'security'}, 'review_axes_incomplete')
    sessions = []
    for review in reviews:
        report, settings_path = Path(review['report']), Path(review['settings'])
        require(report.resolve().parent == NEUTRAL and settings_path.resolve().parent == NEUTRAL,
                'review_path_binding')
        settings = json.loads(settings_path.read_text())
        require(review['verdict'] == 'CLEAR' and re.match(r'^\s*(?:\*\*)?CLEAR\b', report.read_text()), 'review_not_clear')
        require(settings['head'] == gate['sourceHead'] and digest(report) == settings['reportSha256'], 'review_report_binding')
        contexts = settings['actualTurnContexts']
        require(contexts and all(row['model'] == 'gpt-6.1-sol' and row['effort'] == 'high'
                and row['sandbox_policy']['type'] == 'read-only' and row['approval_policy'] == 'never'
                for row in contexts), 'review_runtime_binding')
        sessions.append(settings['session'])
    require(len(set(sessions)) == 2, 'review_session_duplicate')
    require(gate['applicableWorkflowCount'] == 10, 'applicable_ci_count')
    validate_ci(gate['ci'], gate['sourceHead'])
    require(gate['ci'] == json.loads((NEUTRAL / 'preversion-ci.json').read_text()), 'ci_receipt_binding')
    candidate = Path(gate['candidateDirectory']).resolve()
    candidate_files = validate_candidate(source, candidate)
    validate_files(gate['files'], mandatory_files(source, candidate_files, reviews))
    require(subprocess.check_output([str(NODE), '--version'], text=True).strip() == 'v24.21.0', 'node_version_binding')
    require(json.loads((CLI.parent.parent / 'package.json').read_text())['version'] == '4.8.2', 'cli_version_binding')
    require(not Path('/home/serveradmin/.local/share/@shopify/cli/package.json').exists(), 'external_plugin_registry_changed')
    return gate, candidate


def main():
    gate_path = Path(sys.argv[1]).resolve()
    gate, candidate = validate_gate(gate_path)
    CANONICAL.mkdir(mode=0o700, exist_ok=True)
    require(not CANONICAL.is_symlink() and CANONICAL.stat().st_uid == os.getuid(), 'canonical_owner_or_symlink')
    require(CANONICAL.stat().st_mode & 0o777 == 0o700, 'canonical_permissions')
    # The exclusive/fsynced reservation survives failure or crash. No retry or release path exists.
    durable_new(CANONICAL / 'creation-reservation.json', {
        'sourceHead': gate['sourceHead'], 'gateSha256': digest(gate_path),
        'attempt': 1, 'ceiling': 1, 'noBuild': True, 'noRelease': True, 'versionTag': gate['versionTag'],
    })
    environment = {key: os.environ[key] for key in ['HOME', 'PATH', 'LANG', 'LC_ALL', 'TZ', 'TERM'] if key in os.environ}
    environment.update({'CI': '1', 'SHOPIFY_CLI_NO_ANALYTICS': '1'})
    arguments = [str(NODE), str(CLI), 'app', 'deploy', '--path', str(candidate),
                 '--config', 'm5-019', '--no-build', '--no-release', '--version', gate['versionTag'], '--no-color']
    with (CANONICAL / 'cli-output.private.log').open('x') as output:
        os.chmod(output.name, 0o600)
        process = subprocess.Popen(arguments, cwd=candidate, env=environment, stdin=subprocess.DEVNULL,
                                   stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            exit_code = process.wait(timeout=300)
            result = {'dispatches': 1, 'exit': exit_code,
                      'outcome': 'CLI_COMPLETED_READBACK_REQUIRED' if exit_code == 0 else 'STOPPED_NO_RETRY'}
        except subprocess.TimeoutExpired:
            import signal
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            result = {'dispatches': 1, 'outcome': 'AMBIGUOUS_TIMEOUT_NO_RETRY'}
    durable_new(CANONICAL / 'dispatch-result.json', result)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
