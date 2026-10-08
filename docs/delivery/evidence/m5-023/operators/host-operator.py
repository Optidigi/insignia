"""Fixed M5-023 host actions. Run only after the complete frozen gate/access renewal.

Private backups/credentials stay on host. Output is bounded metadata, never env,
SQL errors, dump bytes, provider tokens, staff identities or Docker inspect bodies.
Every mutation reserves a durable event first. A used action is never retried.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time
from urllib.parse import urlsplit

ROOT = Path('/home/serveradmin/insignia-m5-023-run')
APP = Path('/home/serveradmin/insignia-rewrite-m5-019')
WEB = 'insignia-rewrite-m5-019-web'
DB = 'insignia-rewrite-m5-019-database'
OTHERS = [DB, 'insignia-app', 'traefik']
OLD_IMAGE = 'sha256:8aa439cb733160ce6b99165e8401cfbc60f612851aeef0d76735db92917dc3f5'
ORIGIN = 'https://insignia-app.optidigi.nl'
DOMAIN = 'insignia-rewrite-dev.myshopify.com'
MIGRATION = '20261008000100'


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def syncdir(path):
    fd = os.open(path, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def exclusive(path, data):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    syncdir(path.parent)


def run(args, stdin=None, timeout=60, env=None):
    environment = env if env is not None else {key: value for key, value in os.environ.items()
        if not key.startswith(('DOCKER_', 'COMPOSE_'))}
    command = ['docker', '--context', 'default', *args[1:]] if args[0] == 'docker' and args[1] != '--context' else args
    result = subprocess.run(command, input=stdin, capture_output=True, timeout=timeout, env=environment)
    require(result.returncode == 0, 'Host command failed; stop without retry')
    return result.stdout


def inspect(names):
    return json.loads(run(['docker', 'inspect', *names]))


def compose_web(image):
    require(re.fullmatch(r'sha256:[0-9a-f]{64}', image) is not None, 'Reviewed image identity invalid')
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith(('INSIGNIA_', 'COMPOSE_', 'DOCKER_'))}
    environment.update({'INSIGNIA_WEB_IMAGE': image, 'INSIGNIA_ROUTE_ENABLED': 'true'})
    command = ['docker', '--context', 'default', 'compose', '--project-name', 'insignia-rewrite-m5-019',
               '--project-directory', str(APP), '--env-file', str(APP / '.env'), '-f', str(APP / 'compose.yaml')]
    resolved = json.loads(run([*command, 'config', '--format', 'json'], env=environment))
    web = resolved.get('services', {}).get('web', {})
    require(web.get('image') == image and web.get('environment', {}).get('APP_URL') == ORIGIN
            and web.get('labels', {}).get('traefik.enable') == 'true'
            and web.get('labels', {}).get('traefik.http.routers.insignia-canonical-m5-019r.rule')
            == 'Host(`insignia-app.optidigi.nl`)', 'Resolved Compose web identity drift')
    run([*command, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'web'], timeout=120, env=environment)


def identities(containers):
    return {c['Name']: [c['Id'], c['Image'], c['State']['StartedAt']] for c in containers}


def sql(statement):
    return run(['docker', 'exec', '-i', DB, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                '-U', 'insignia_rewrite', '-d', 'insignia_rewrite'], statement.encode())


def event(action, payload):
    value = {'action': action, 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), **payload}
    exclusive(ROOT / (action + '.json'), (json.dumps(value, sort_keys=True) + '\n').encode())
    return value


def finish(action, payload):
    value = event(action + '-settled', payload)
    print(json.dumps(value, sort_keys=True))


def prestate():
    current = inspect([WEB, *OTHERS])
    web = current[0]
    require(web['State']['Status'] == 'running', 'Web not running')
    require('APP_URL=' + ORIGIN in web['Config']['Env'], 'Canonical origin mismatch')
    require(web['HostConfig']['ReadonlyRootfs'] is True and web['Config']['User'] == 'node', 'Runtime isolation mismatch')
    require(web['Config']['Labels']['traefik.http.routers.insignia-canonical-m5-019r.rule'] == 'Host(`insignia-app.optidigi.nl`)', 'Canonical router mismatch')
    return current


def lifecycle():
    """Read-only qualification; never install/start a missing worker or seed queue state."""
    web = prestate()[0]
    environment = dict(value.split('=', 1) for value in web['Config']['Env'])
    expected = json.loads((ROOT / 'expected-inputs.json').read_text())
    target = urlsplit(environment.get('DATABASE_URL', ''))
    require(target.hostname is not None and target.path, 'Runtime database identity unavailable')
    ids = run(['docker', 'ps', '-q']).decode().split()
    require(len(ids) <= 200, 'Container inventory exceeds fixed bound')
    containers = inspect(ids) if ids else []
    candidates = []
    for container in containers:
        command = container['Config'].get('Cmd') or []
        if len(command) < 2 or Path(command[0]).name != 'node' or Path(command[1]).name != 'main.js':
            continue
        values = dict(value.split('=', 1) for value in container['Config'].get('Env', []))
        address = urlsplit(values.get('DATABASE_URL', ''))
        if (address.hostname, address.port, address.path) != (target.hostname, target.port, target.path):
            continue
        candidates.append((container, command, values))
    checks = {'exactWorkerArtifact': False, 'workerReady': False, 'workerKeyConfigurationPresent': False,
              'runtimeRoleExact': target.username == 'insignia_runtime', 'workerRoleExact': False,
              'webhookSecretMatchesApp': bool(environment.get('SHOPIFY_WEBHOOK_SECRET'))
                and environment.get('SHOPIFY_WEBHOOK_SECRET') == environment.get('SHOPIFY_CLIENT_SECRET')}
    if len(candidates) == 1:
        worker, command, values = candidates[0]
        entry = Path(command[1])
        checks['workerRoleExact'] = urlsplit(values.get('DATABASE_URL', '')).username == 'insignia_runtime'
        inspector = (ROOT / 'worker-inventory.mjs').read_bytes()
        inventory_bytes = (ROOT / 'worker-executable-inventory.json').read_bytes()
        require(sha(inspector) == expected['workerInspectorSha256']
                and sha(inventory_bytes) == expected['workerInventorySha256'], 'Worker inspection input drift')
        # Hash every executable package/dependency without importing any of them.
        # Reject preloads and unsupported commands before any health request.
        command_exact = len(command) in (2, 3) and (len(command) == 2 or re.fullmatch(r'--port=[0-9]+', command[2]))
        immutable_code = worker.get('HostConfig', {}).get('ReadonlyRootfs') is True \
            and worker['Config'].get('User') == 'node' and entry.is_absolute() and entry.parts[1] != 'tmp' \
            and not any(mount.get('RW') and mount.get('Destination') != '/tmp' for mount in worker.get('Mounts', []))
        if command_exact and immutable_code and not values.get('NODE_OPTIONS') and not values.get('NODE_PATH'):
            artifact = json.loads(run(['docker', 'exec', '-i', worker['Id'], 'node', '--input-type=module', '-e',
                inspector.decode() + '\ninspectWorkerFromStdin();'],
                json.dumps({'entry': str(entry), 'inventory': json.loads(inventory_bytes)}).encode(), timeout=30))
            checks['exactWorkerArtifact'] = artifact.get('exact') is True
        checks['workerKeyConfigurationPresent'] = all(values.get(key) for key in
            ['INSIGNIA_CREDENTIAL_KEY_ID', 'INSIGNIA_CREDENTIAL_KEY_BASE64', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'])
        checks['workerKeyConfigurationPresent'] = bool(checks['workerKeyConfigurationPresent']
            and values.get('SHOPIFY_CLIENT_ID') == environment.get('SHOPIFY_CLIENT_ID'))
        port = next((arg.split('=', 1)[1] for arg in command[2:] if arg.startswith('--port=')), '4301')
        require(port.isdigit() and 0 < int(port) <= 65535, 'Worker health port invalid')
        if checks['exactWorkerArtifact']:
            probe = "fetch('http://127.0.0.1:" + port + "/ready').then(async r=>console.log(JSON.stringify({status:r.status,body:await r.json()}))).catch(()=>console.log(JSON.stringify({status:503})))"
            health = json.loads(run(['docker', 'exec', worker['Id'], 'node', '-e', probe], timeout=10))
            checks['workerReady'] = health.get('status') == 200 and health.get('body', {}).get('durableReady') is True
    rights = json.loads(sql("""BEGIN READ ONLY; SELECT json_build_object(
      'uninstallRuntimeUsable',has_schema_privilege('insignia_runtime','public','USAGE')
        AND NOT EXISTS(SELECT 1 FROM (VALUES
          ('shops','SELECT'),('shops','UPDATE'),
          ('installation_generations','SELECT'),('installation_generations','UPDATE'),
          ('shop_credentials','SELECT'),('shop_credentials','UPDATE'),
          ('product_configs','SELECT'),('product_configs','UPDATE'),
          ('inbox_messages','SELECT'),('inbox_messages','UPDATE'),
          ('shopify_webhook_deliveries','SELECT')) AS required(relation,privilege)
          WHERE NOT has_table_privilege('insignia_runtime','public.'||required.relation,required.privilege)),
      'queueSchemaPresent', EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='pgboss'),
      'queueRuntimeUsable',COALESCE((SELECT has_schema_privilege('insignia_runtime',oid,'USAGE') FROM pg_namespace WHERE nspname='pgboss'),false)
        AND EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='pgboss' AND c.relkind IN ('r','p'))
        AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='pgboss' AND c.relkind IN ('r','p') AND EXISTS(SELECT 1 FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS privilege(name) WHERE NOT CASE WHEN n.nspname='pgboss' AND c.relkind IN ('r','p') THEN has_table_privilege('insignia_runtime',c.oid,privilege.name) ELSE true END))
        AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='pgboss' AND c.relkind='S' AND NOT CASE WHEN n.nspname='pgboss' AND c.relkind='S' THEN has_sequence_privilege('insignia_runtime',c.oid,'USAGE') ELSE true END)
        AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='pgboss' AND NOT has_function_privilege('insignia_runtime',p.oid,'EXECUTE'))); COMMIT;"""))
    checks.update(rights)
    passed = len(candidates) == 1 and all(checks.values())
    finish('lifecycle', {'classification': 'PASS_UNINSTALL_PROCESSOR' if passed else 'BLOCKED_UNINSTALL_PROCESSOR_READINESS',
                        'checks': checks, 'candidateCount': len(candidates), 'providerRequests': 0,
                        'databaseWrites': 0, 'workerDeployments': 0, 'runtimeEnvironmentValuesLogged': False})


def require_lifecycle():
    receipt = ROOT / 'lifecycle-settled.json'
    require(receipt.is_file() and json.loads(receipt.read_text()).get('classification') == 'PASS_UNINSTALL_PROCESSOR',
            'Uninstall processor readiness unqualified; no provisioning/deployment')


def backup():
    require_lifecycle()
    current = prestate()
    require(current[0]['Image'] == OLD_IMAGE, 'Entry image drift')
    event('backup-reserved', {'oldImage': OLD_IMAGE, 'unrelatedIdentities': identities(current[1:])})
    target = ROOT / 'backup'
    target.mkdir(mode=0o700)
    syncdir(ROOT)
    hashes = {}
    for name in ['compose.yaml', '.env', 'runtime.env', 'database.env']:
        require((APP / name).is_file(), 'Required rollback file missing')
        data = (APP / name).read_bytes()
        exclusive(target / name, data)
        hashes[name] = sha(data)
    dump = run(['docker', 'exec', DB, 'pg_dump', '-Fc', '-U', 'insignia_rewrite', '-d', 'insignia_rewrite'], timeout=120)
    require(dump.startswith(b'PGDMP'), 'Backup format mismatch')
    exclusive(target / 'database.dump', dump)
    run(['docker', 'exec', '-i', DB, 'pg_restore', '--list'], dump)
    globals_bytes = run(['docker', 'exec', DB, 'pg_dumpall', '--globals-only', '--no-role-passwords', '-U', 'insignia_rewrite'])
    exclusive(target / 'roles.sql', globals_bytes)
    hashes.update({'database.dump': sha(dump), 'roles.sql': sha(globals_bytes)})
    finish('backup', {'backupHashes': hashes, 'dumpListVerified': True, 'oldImage': OLD_IMAGE,
                      'webRollback': 'restore .env from private backup; compose up web only; retain DB evidence',
                      'databaseRestore': 'operator disaster recovery only from private PG18 custom dump; no automatic schema down'})


def provision():
    require_lifecycle()
    require((ROOT / 'backup-settled.json').is_file(), 'Backup receipt missing')
    require(prestate()[0]['Image'] == OLD_IMAGE, 'Image drift before provisioning')
    expected = json.loads((ROOT / 'expected-inputs.json').read_text())
    migration = (ROOT / 'migration16.sql').read_bytes()
    roles = (ROOT / 'trusted-release-roles.sql').read_bytes()
    require(sha(migration) == expected['migrationSha256'] and sha(roles) == expected['rolesSha256'], 'Provisioning input drift')
    versions = sql('SELECT version FROM schema_migrations ORDER BY version;').decode().split()
    require(versions == expected['priorMigrationVersions'], 'Schema history drift')
    require(sql("SELECT to_regclass('public.trusted_release_records') IS NULL;").strip() == b't', 'Unexpected trusted relation')
    require(sql("SELECT count(*) FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='insignia_runtime');").strip() == b'0', 'Runtime role membership drift')
    event('provision-reserved', {'migration': MIGRATION, 'migrationSha256': sha(migration), 'rolesSha256': sha(roles)})
    password = secrets.token_urlsafe(48)
    require(re.fullmatch('[A-Za-z0-9_-]{64}', password) is not None, 'Operator credential generation failed')
    exclusive(ROOT / 'release-operator-credential.json', json.dumps({'user': 'insignia_release_operator', 'password': password}).encode())
    up = migration.decode().split('-- migrate:up', 1)[1].split('-- migrate:down', 1)[0]
    statement = 'BEGIN; SELECT pg_advisory_xact_lock(50230016);\n' + up + '\n' + roles.decode()
    statement += "\nALTER ROLE insignia_release_operator LOGIN PASSWORD '" + password + "';\n"
    statement += "INSERT INTO schema_migrations(version) VALUES ('" + MIGRATION + "'); COMMIT;"
    sql(statement)
    rights = json.loads(sql("""SELECT json_build_object(
      'runtimeSelect',has_table_privilege('insignia_runtime','trusted_release_records','SELECT'),
      'runtimeWrite',has_table_privilege('insignia_runtime','trusted_release_records','INSERT,UPDATE,DELETE,TRUNCATE'),
      'runtimeSchemaCreate',has_schema_privilege('insignia_runtime','public','CREATE'),
      'operatorInsert',has_table_privilege('insignia_release_operator','trusted_release_records','INSERT'),
      'operatorRewrite',has_table_privilege('insignia_release_operator','trusted_release_records','UPDATE,DELETE,TRUNCATE'),
      'runtimeOperatorMembership',pg_has_role('insignia_runtime','insignia_release_operator','MEMBER'),
      'runtimeOwnerMembership',pg_has_role('insignia_runtime','insignia_release_owner','MEMBER'),
      'relationOwner',(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='trusted_release_records'::regclass),
      'rewriteTriggers',(SELECT count(*) FROM pg_trigger WHERE tgrelid='trusted_release_records'::regclass AND NOT tgisinternal),
      'records',(SELECT count(*) FROM trusted_release_records));"""))
    require(rights['runtimeSelect'] and rights['operatorInsert'] and not any(rights[key] for key in
        ['runtimeWrite', 'runtimeSchemaCreate', 'operatorRewrite', 'runtimeOperatorMembership', 'runtimeOwnerMembership']), 'Privilege readback mismatch')
    require(rights['relationOwner'] == 'insignia_release_owner' and rights['rewriteTriggers'] == 2 and rights['records'] == 0, 'Trusted schema readback mismatch')
    finish('provision', {'rights': rights, 'tenantSeeds': 0, 'trustedEvidenceAppends': 0, 'migration': MIGRATION})


def deploy():
    require_lifecycle()
    require((ROOT / 'provision-settled.json').is_file(), 'Provisioning receipt missing')
    expected = json.loads((ROOT / 'expected-inputs.json').read_text())
    current = prestate()
    require(current[0]['Image'] == OLD_IMAGE, 'Web image drift before deployment')
    event('deploy-reserved', {'archiveSha256': expected['archiveSha256'], 'oldImage': OLD_IMAGE})
    archive = ROOT / 'reviewed-web-package.tar.gz'
    require(sha(archive.read_bytes()) == expected['archiveSha256'], 'Reviewed archive mismatch')
    context = ROOT / 'build-context'
    require(context.is_dir(), 'Reviewed context missing')
    require(sha((context / 'Dockerfile').read_bytes()) == expected['dockerfileSha256'], 'Dockerfile mismatch')
    entry = context / 'runtime/dist/server/entry.mjs'
    require(sha(entry.read_bytes()) == expected['entrySha256'], 'Entry mismatch')
    # The context manifest is verified before docker build; no registry/network or source build.
    inventory_bytes = (ROOT / 'package-inventory.json').read_bytes()
    require(sha(inventory_bytes) == expected['inventorySha256'], 'Context inventory drift')
    inventory = json.loads(inventory_bytes)
    actual_paths = {str(file.relative_to(context)) for file in context.rglob('*') if file.is_file() or file.is_symlink()}
    require(actual_paths == set(inventory), 'Context path inventory drift')
    for relative, record in inventory.items():
        file = context / relative
        require(file.resolve().is_relative_to(context.resolve()), 'Context link escape')
        if record['kind'] == 'symlink':
            require(file.is_symlink() and str(file.readlink()) == record['target'], 'Context link drift')
        else:
            require(file.is_file() and not file.is_symlink() and sha(file.read_bytes()) == record['sha256'], 'Context file drift')
    tag = 'insignia-rewrite-m5-023:' + expected['sourceCommit'][:12]
    run(['docker', 'build', '--network=none', '--pull=false', '-t', tag, str(context)], timeout=240)
    image = json.loads(run(['docker', 'image', 'inspect', tag]))[0]
    require(image['Config']['User'] == 'node' and image['Config']['WorkingDir'] == '/srv/insignia', 'Image runtime mismatch')
    lines = (APP / '.env').read_text().splitlines()
    positions = [i for i, line in enumerate(lines) if line.startswith('INSIGNIA_WEB_IMAGE=')]
    require(len(positions) == 1, 'Image configuration ambiguous')
    lines[positions[0]] = 'INSIGNIA_WEB_IMAGE=' + image['Id']
    temporary = APP / '.env.m5-023-new'
    exclusive(temporary, ('\n'.join(lines) + '\n').encode())
    os.replace(temporary, APP / '.env')
    syncdir(APP)
    compose_web(image['Id'])
    for _ in range(45):
        web = inspect([WEB])[0]
        if web['State'].get('Health', {}).get('Status') == 'healthy':
            break
        time.sleep(1)
    require(web['State'].get('Health', {}).get('Status') == 'healthy' and web['Image'] == image['Id'], 'Deployment unsettled; stop, no retry')
    require(identities(inspect(OTHERS)) == identities(current[1:]), 'Unrelated service changed')
    actual = run(['docker', 'exec', WEB, 'sha256sum', 'dist/server/entry.mjs']).decode().split()[0]
    require(actual == expected['entrySha256'], 'Deployed entry drift')
    finish('deploy', {'image': image['Id'], 'sourceCommit': expected['sourceCommit'], 'entrySha256': actual,
                     'health': 'healthy', 'unrelatedServicesUnchanged': True, 'rollbackImage': OLD_IMAGE})


def restart():
    require((ROOT / 'deploy-settled.json').is_file(), 'Deployment receipt missing')
    before = prestate()
    event('restart-reserved', {'image': before[0]['Image']})
    run(['docker', 'restart', '--time', '10', WEB], timeout=45)
    for _ in range(45):
        after = prestate()
        if after[0]['State'].get('Health', {}).get('Status') == 'healthy':
            break
        time.sleep(1)
    require(after[0]['State'].get('Health', {}).get('Status') == 'healthy', 'Restart health unsettled')
    require(after[0]['Id'] == before[0]['Id'] and after[0]['Image'] == before[0]['Image'] and after[0]['State']['StartedAt'] != before[0]['State']['StartedAt'], 'Restart image drift')
    require(identities(after[1:]) == identities(before[1:]), 'Unrelated restart drift')
    finish('restart', {'image': after[0]['Image'], 'health': 'healthy', 'unrelatedServicesUnchanged': True})


def state():
    current = prestate()
    data = json.loads(sql("""BEGIN READ ONLY; SELECT json_build_object(
      'tenant',(SELECT row_to_json(t) FROM (SELECT s.shop_id,s.shop_domain,s.shopify_shop_id,
        s.current_generation,i.external_installation_id,(i.deactivated_at IS NULL) AS active
        FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation
        WHERE s.shop_domain='insignia-rewrite-dev.myshopify.com') t),
      'signingKeyCount',(SELECT count(*) FROM signing_keys k JOIN shops s ON s.shop_id=k.shop_id
        WHERE s.shop_domain='insignia-rewrite-dev.myshopify.com' AND k.installation_generation=s.current_generation),
      'trustedReleaseCount',(SELECT count(*) FROM trusted_release_records r JOIN shops s ON s.shop_id=r.shop_id
        WHERE s.shop_domain='insignia-rewrite-dev.myshopify.com'));
      COMMIT;"""))
    env = {line.split('=', 1)[0] for line in current[0]['Config']['Env']}
    result = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'image': current[0]['Image'],
              'exactDomain': DOMAIN, 'durable': data, 'commercialKeyPresence': {key: key in env for key in
              ['INSIGNIA_M5_ENTITLEMENT_POLICY_JSON', 'INSIGNIA_M5_FEATURES_JSON', 'INSIGNIA_PARTNER_ORGANIZATION_ID', 'INSIGNIA_PARTNER_ACCESS_TOKEN']}}
    print(json.dumps(result, sort_keys=True))



def append():
    require((ROOT / 'owner-search-settled.json').is_file(), 'Owner Search qualification missing')
    owner = json.loads((ROOT / 'owner-search-settled.json').read_text())
    require(owner.get('classification') == 'PASS_AUTH' and owner.get('exactDomain') == DOMAIN, 'Owner Search not qualified')
    reservations = list(ROOT.glob('trusted-append-*-reserved.json'))
    require(len(reservations) < 2, 'Trusted append ceiling reached')
    if reservations:
        require((ROOT / 'merchant-activation-ready.json').is_file(), 'Second append requires qualified actual merchant activation')
        activation = json.loads((ROOT / 'merchant-activation-ready.json').read_text())
        require(activation.get('commercialEligibility') == 'OWNER_AUTHORITY_AND_CURRENT_PROVIDER_QUALIFIED', 'Commercial authority missing')
        require(all(json.loads(path.with_name(path.name.replace('-reserved.json', '-result.json')).read_text()).get('classification') == 'TRUSTED_RELEASE_APPEND_ACK_RUNTIME_QUALIFIED' for path in reservations), 'Earlier append not settled')
    expected = json.loads((ROOT / 'expected-inputs.json').read_text())
    source = (ROOT / 'release-append.mjs').read_bytes()
    require(sha(source) == expected['releaseAppendSha256'], 'Trusted append operator drift')
    raw = (ROOT / 'release-append-input.json').read_bytes()
    require(len(raw) <= 128_000, 'Append input too large')
    payload = json.loads(raw)
    require(set(payload) == {'recordId', 'activeObservation', 'readiness'}, 'Append envelope invalid')
    require(re.fullmatch('[0-9a-f-]{36}', payload['recordId']) is not None, 'Append record ID invalid')
    action = 'trusted-append-' + payload['recordId']
    event(action + '-reserved', {'recordId': payload['recordId'], 'publicInputSha256': sha(raw)})
    payload['operator'] = json.loads((ROOT / 'release-operator-credential.json').read_text())
    response = subprocess.run(['docker', '--context', 'default', 'exec', '-i', WEB, 'node', '--input-type=module', '-e', source.decode()],
                              input=json.dumps(payload).encode(), capture_output=True, timeout=30,
                              env={key: value for key, value in os.environ.items() if not key.startswith(('DOCKER_', 'COMPOSE_'))})
    require(len(response.stdout) <= 32_000, 'Append result too large; settlement unknown')
    result = json.loads(response.stdout)
    require(result.get('recordId') == payload['recordId'], 'Append result identity mismatch')
    require(result.get('classification') in ['TRUSTED_RELEASE_APPEND_ACK_RUNTIME_QUALIFIED', 'TRUSTED_RELEASE_APPEND_STOPPED'], 'Append result classification invalid')
    require(not any(key in result for key in ['operator', 'password', 'accessToken']), 'Unsafe append result')
    settled = event(action + '-result', {**result, 'exit': response.returncode})
    print(json.dumps(settled, sort_keys=True))
    if response.returncode != 0:
        sys.exit(1)


actions = {'lifecycle': lifecycle, 'backup': backup, 'provision': provision, 'deploy': deploy, 'restart': restart, 'state': state, 'append': append}
if __name__ == '__main__':
    try:
        require(len(sys.argv) == 2 and sys.argv[1] in actions, 'Unknown host action')
        require(ROOT.is_dir() and (ROOT.stat().st_mode & 0o777) == 0o700, 'Private run directory invalid')
        actions[sys.argv[1]]()
    except Exception as error:
        print(json.dumps({'classification': 'HOST_ACTION_STOPPED', 'action': sys.argv[1] if len(sys.argv) == 2 else 'invalid',
                          'reason': str(error) if isinstance(error, RuntimeError) else 'Unexpected local failure',
                          'retryAuthorized': False, 'secretValuesLogged': False}))
        sys.exit(1)
