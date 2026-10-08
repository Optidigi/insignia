"""Local PG18 DBA-client routing control; Docker/SSH/provider requests are forbidden.

The filesystem/transport seam maps the fixed container socket to one owned local
socket. It supplies a redirecting synthetic container environment to real libpq
clients. Processor qualification is a separately tested precondition here.
"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

mode, control_root, binary_root, library_root = sys.argv[1:]
assert mode in ('red', 'green', 'green2')
root = Path(control_root) / ('dba-route-' + mode)
root.mkdir(mode=0o700)
binary = Path(binary_root)
environment = {'PATH': str(binary) + ':/usr/bin:/bin', 'LD_LIBRARY_PATH': library_root}
module_spec = importlib.util.spec_from_file_location('host_operator', Path(__file__).with_name('host-operator.py'))
operator = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(operator)
started = []


def local(args, stdin=None):
    return subprocess.run(args, input=stdin, capture_output=True, env=environment, check=True).stdout


try:
    for identity in ('a', 'b'):
        data = root / (identity + '-data')
        socket = root / (identity + '-socket')
        socket.mkdir(mode=0o700)
        local([str(binary / 'initdb'), '-D', str(data), '-A', 'trust', '--no-locale', '--encoding=UTF8'])
        local([str(binary / 'pg_ctl'), '-D', str(data), '-l', str(root / (identity + '-server.log')),
               '-o', "-h '' -p 5432 -k " + str(socket), '-w', 'start'])
        started.append(data)
        def setup(statement, database='postgres'):
            return local([str(binary / 'psql'), '-h', str(socket), '-p', '5432', '-U', 'serveradmin',
                          '-d', database, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], statement.encode())
        setup('CREATE ROLE insignia_rewrite LOGIN; CREATE DATABASE insignia_rewrite OWNER insignia_rewrite; '
              + 'CREATE ROLE route_' + identity + '_only NOLOGIN;')
        migrations = Path(__file__).resolve().parents[5] / 'packages/database/migrations'
        for path in sorted(migrations.glob('*.sql')):
            setup(path.read_text().split('-- migrate:up', 1)[1].split('-- migrate:down', 1)[0], 'insignia_rewrite')
        setup("CREATE TABLE public.route_marker(marker text); INSERT INTO public.route_marker VALUES ('" + identity + "'); "
              'GRANT SELECT ON ALL TABLES IN SCHEMA public TO insignia_rewrite; '
              'GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO insignia_rewrite;', 'insignia_rewrite')
    app = root / 'synthetic-app'
    app.mkdir()
    for name in ['compose.yaml', '.env', 'runtime.env', 'database.env']:
        (app / name).write_text('synthetic local routing-control bytes\n')
    run_root = root / 'synthetic-run'
    run_root.mkdir(mode=0o700)
    operator.ROOT, operator.APP = run_root, app
    # Separate lifecycle precondition seam; full current qualifier is covered by
    # host-operator-controls.py, not claimed by this DBA transport control.
    operator.require_lifecycle = lambda: None
    operator.prestate = lambda: [dict(Name=name, Id=name, Image=operator.OLD_IMAGE,
        State={'StartedAt': 'synthetic'}) for name in [operator.WEB, *operator.OTHERS]]
    calls = []
    def container_transport(args, stdin=None, timeout=60, env=None):
        assert args[:2] == ['docker', 'exec'] and operator.DB in args
        command = args[args.index(operator.DB) + 1:]
        inherited = {**environment, 'PGHOST': str(root / 'b-socket'), 'PGPORT': '5432'}
        if command[:2] == ['env', '-i']:
            # Translate only the container's fixed filesystem/tool layout. Routing
            # and env clearing remain the exact source's real env/libpq behavior.
            command = ['env', '-i', 'LD_LIBRARY_PATH=' + library_root, *command[2:]]
        mapped = []
        for value in command:
            if value in ('psql', 'pg_dump', 'pg_dumpall', 'pg_restore'):
                calls.append(value)
                value = str(binary / value)
            if value == '--host=/var/run/postgresql':
                value = '--host=' + str(root / 'a-socket')
            mapped.append(value)
        return subprocess.run(mapped, input=stdin, capture_output=True, timeout=timeout,
                              env=inherited, check=True).stdout
    operator.run = container_transport
    sql_target = operator.sql('SELECT marker FROM public.route_marker;').decode().strip()
    session_qualified = operator.qualify_dba({'Config': {'Env': []}})
    calls_before_redirect = len(calls)
    redirect_rejected = not operator.qualify_dba({'Config': {'Env': ['PGHOST=synthetic-redirect']}})
    assert redirect_rejected and len(calls) == calls_before_redirect
    operator.backup()
    dump = (run_root / 'backup/database.dump').read_bytes()
    data = local([str(binary / 'pg_restore'), '--data-only', '--table=route_marker', '-f', '-'], dump).decode()
    globals_text = (run_root / 'backup/roles.sql').read_text()
    result = {'actualDbaSessionQualified': session_qualified, 'redirectKeyRejectedBeforeSql': redirect_rejected, 'sqlTarget': sql_target, 'dumpDesignated': '\na\n' in data,
              'globalsDesignated': 'route_a_only' in globals_text and 'route_b_only' not in globals_text,
              'actualLibpqTools': calls, 'dockerCommands': 0, 'providerRequests': 0, 'productionWrites': 0,
              'fixtureProvenance': 'Two isolated synthetic PG18 socket clusters; precondition/transport seams'}
    print(json.dumps(result), flush=True)
    assert session_qualified and sql_target == 'a' and result['dumpDesignated'] and result['globalsDesignated']
finally:
    for data in started:
        local([str(binary / 'pg_ctl'), '-D', str(data), '-m', 'fast', '-w', 'stop'])
