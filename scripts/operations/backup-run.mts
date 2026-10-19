/** One allocated writer exclusion, snapshot, backup and exact resume. */
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  array,
  check,
  digest,
  durable,
  jsonFile,
  number,
  privateDirectory,
  record,
  remove,
  requireTmpfs,
  sourceEnvironment,
  syncDirectory,
  text,
  timestamp,
} from './backup-files.mts';
import { acquireFileLock } from './backup-lock.mts';
export type Container = Record<string, unknown> & {
  service: string;
  name: string;
  id: string;
  imageId: string;
  configSha256: string;
  healthRequired: boolean;
  project?: string;
};
export type DockerRow = Record<string, unknown> & {
  Id: string;
  Image: string;
  Name: string;
  Config: Record<string, unknown>;
  State: { Status: string; ExitCode?: number; OOMKilled?: boolean; Health?: { Status: string } };
  RestartCount: number;
};
export type InspectorConfig = Record<string, unknown> & { unit: string; configSha256: string };
export type Configuration = Record<string, unknown> & {
  format: string;
  project: string;
  windowSeconds: number;
  containers: Container[];
  runtimeDirectory: string;
  receiptDirectory?: string;
  hostInspector?: InspectorConfig;
};
export type InspectorRow = {
  configSha256: string;
  status: 'running' | 'exited';
  invocation: string;
  jobs: boolean;
  socket: boolean;
  process?: { pid: number; startTicks: string | null };
};
export interface DockerBoundary {
  inspect(item: Container): DockerRow | Promise<DockerRow>;
  stop(item: Container, signal?: AbortSignal): void | Promise<void>;
  start(item: Container): void | Promise<void>;
}
export interface InspectorBoundary {
  inspect(): InspectorRow | Promise<InspectorRow>;
  ready(): boolean | Promise<boolean>;
  verifyArtifact(): void | Promise<void>;
  stop(signal?: AbortSignal): void | Promise<void>;
  start(): void | Promise<void>;
}
const ROLES = new Set([
  'web',
  'worker',
  'inspector',
  'verifier',
  'maintenance',
  'release-verifier',
  'artwork-inspector',
]);
function compareKeys(a: string, b: string): number {
  const left = [...a],
    right = [...b];
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const x = left[index]?.codePointAt(0),
      y = right[index]?.codePointAt(0);
    check(x !== undefined && y !== undefined, 'Invalid JSON key');
    if (x !== y) return x - y;
  }
  return left.length - right.length;
}
/** Preserve sorted Python ASCII JSON, including numeric-looking object keys. */
export function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => compareKeys(a, b))
      .map(([key, value]) => `${canonicalJSON(key)}:${canonicalJSON(value)}`)
      .join(',')}}`;
  }
  check(
    value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value)),
    'JSON value required',
  );
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}
export function fingerprint(row: Record<string, unknown>): string {
  return createHash('sha256')
    .update(
      canonicalJSON(
        Object.fromEntries(
          ['Id', 'Name', 'Image', 'Config', 'HostConfig', 'Mounts'].map((key) => [key, row[key] ?? null]),
        ),
      ),
    )
    .digest('hex');
}
export function configuration(value: unknown): Configuration {
  const raw = record(value);
  check(
    raw.format === 'insignia-backup-run-v1' &&
      /^insignia-[a-z0-9-]+$/.test(text(raw.project)) &&
      Number.isInteger(raw.windowSeconds) &&
      number(raw.windowSeconds) >= 60 &&
      number(raw.windowSeconds) <= 3600,
    'reviewed Insignia run configuration required',
  );
  const containers = array(raw.containers).map((value) => {
    const item = record(value);
    check(typeof item.healthRequired === 'boolean', 'unsupported writer allocation');
    const base: Container = {
      ...item,
      service: text(item.service),
      name: text(item.name),
      id: text(item.id),
      imageId: text(item.imageId),
      configSha256: text(item.configSha256),
      healthRequired: item.healthRequired,
    };
    if (item.project !== undefined) base.project = text(item.project);
    const project = base.project ?? text(raw.project);
    check(
      /^insignia-[a-z0-9-]+$/.test(project) &&
        ROLES.has(base.service) &&
        base.name.startsWith(`${project}-`) &&
        /^[a-f0-9]{64}$/.test(base.id) &&
        /^sha256:[a-f0-9]{64}$/.test(base.imageId) &&
        /^[a-f0-9]{64}$/.test(base.configSha256),
      'unsupported writer allocation',
    );
    return base;
  });
  check(
    containers.length > 0 &&
      containers.length <= 8 &&
      new Set(containers.map((item) => item.id)).size === containers.length &&
      new Set(containers.map((item) => item.service)).size === containers.length,
    'exact writer allowlist required',
  );
  const result: Configuration = {
    ...raw,
    format: text(raw.format),
    project: text(raw.project),
    windowSeconds: number(raw.windowSeconds),
    runtimeDirectory: text(raw.runtimeDirectory),
    containers,
  };
  if (raw.receiptDirectory !== undefined) result.receiptDirectory = text(raw.receiptDirectory);
  if (raw.hostInspector !== undefined) {
    const host = record(raw.hostInspector);
    check(
      host.unit === 'insignia-artwork-inspection.service' && /^[a-f0-9]{64}$/.test(text(host.configSha256)),
      'qualified host inspector required',
    );
    result.hostInspector = { ...host, unit: host.unit, configSha256: text(host.configSha256) };
  }
  return result;
}
function dockerRow(value: unknown): DockerRow {
  const raw = record(value),
    state = record(raw.State);
  const result: DockerRow = {
    ...raw,
    Id: text(raw.Id),
    Image: text(raw.Image),
    Name: text(raw.Name),
    Config: record(raw.Config),
    State: { Status: text(state.Status) },
    RestartCount: number(raw.RestartCount),
  };
  if (state.ExitCode !== undefined) result.State.ExitCode = number(state.ExitCode);
  if (state.OOMKilled !== undefined) {
    check(typeof state.OOMKilled === 'boolean', 'Invalid OOM flag');
    result.State.OOMKilled = state.OOMKilled;
  }
  if (state.Health !== undefined) result.State.Health = { Status: text(record(state.Health).Status) };
  return result;
}
async function capture(command: string, args: string[], timeout = 15000, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let closed = false,
      result: { failed: boolean; stdout: string } | undefined;
    const finish = () => {
      if (!closed || !result) return;
      if (result.failed) reject(new Error('External operation failed; operator inspection required'));
      else resolve(result.stdout);
    };
    // Match subprocess.run: cancel the local client and reap it before unwinding.
    // Docker's daemon-side --timeout -1 drain remains unchanged; an interrupted stop stays unknown.
    const child = execFile(
      command,
      args,
      { timeout, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', ...(signal ? { signal } : {}), killSignal: 'SIGKILL' },
      (error, stdout) => {
        result = { failed: Boolean(error), stdout };
        finish();
      },
    );
    child.once('close', () => {
      closed = true;
      finish();
    });
  });
}
export class Docker implements DockerBoundary {
  constructor(privateExecutable: string) {
    this.executable = privateExecutable;
  }
  private readonly executable: string;
  async inspect(item: Container): Promise<DockerRow> {
    const rows = array(JSON.parse(await capture(this.executable, ['container', 'inspect', item.id])));
    check(rows.length === 1, 'container identity unavailable');
    return dockerRow(rows[0]);
  }
  async stop(item: Container, signal?: AbortSignal): Promise<void> {
    await capture(this.executable, ['container', 'stop', '--timeout', '-1', item.id], 360000, signal);
    const state = (await this.inspect(item)).State;
    check(
      state.Status === 'exited' && (state.ExitCode === 0 || state.ExitCode === 143) && state.OOMKilled === false,
      'writer drain needs settlement',
    );
  }
  async start(item: Container): Promise<void> {
    await capture(this.executable, ['container', 'start', item.id], 30000);
  }
}
export function verifyInspectorArtifact(release: string, expected: string): void {
  const raw = readFileSync(join(release, 'manifest.json'));
  check(
    raw.length <= 4 * 1024 * 1024 && createHash('sha256').update(raw).digest('hex') === expected,
    'inspector artifact manifest drift',
  );
  const manifest = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)));
  check(manifest.version === 'insignia-artwork-inspector-artifact-v1', 'inspector artifact format drift');
  const files = record(manifest.files),
    remaining = new Set(Object.keys(files));
  let total = 0;
  function walk(directory: string) {
    const info = lstatSync(directory);
    check(
      !info.isSymbolicLink() && info.isDirectory() && info.uid === process.getuid?.() && (info.mode & 0o777) === 0o700,
      'inspector artifact directory drift',
    );
    for (const name of readdirSync(directory)) {
      const path = join(directory, name),
        info = lstatSync(path),
        key = relative(release, path);
      if (info.isDirectory() && !info.isSymbolicLink()) {
        walk(path);
        continue;
      }
      if (['manifest.json', 'receipt.json', 'artwork-inspection.service'].includes(key)) {
        check(info.isFile() && info.uid === process.getuid?.(), 'inspector artifact metadata drift');
        continue;
      }
      const entry = record(files[key]);
      check(info.uid === process.getuid?.(), 'inspector artifact inventory drift');
      remaining.delete(key);
      if (entry.kind === 'link') {
        const target = realpathSync(path);
        check(
          info.isSymbolicLink() &&
            readlinkSync(path) === entry.target &&
            (target === realpathSync(release) || target.startsWith(realpathSync(release) + sep)),
          'inspector artifact link drift',
        );
      } else if (entry.kind === 'file') {
        total += info.size;
        check(
          info.isFile() &&
            (info.mode & 0o777) === entry.mode &&
            info.size <= 512 * 1024 * 1024 &&
            total <= 2 * 1024 * 1024 * 1024 &&
            digest(path) === entry.sha256,
          'inspector artifact bytes drift',
        );
      } else throw new Error('inspector artifact entry drift');
    }
  }
  walk(release);
  check(remaining.size === 0, 'inspector artifact files missing');
}
export class InspectorService implements InspectorBoundary {
  static readonly UNIT = 'insignia-artwork-inspection.service';
  static readonly PROPERTIES = [
    'Id',
    'LoadState',
    'ActiveState',
    'SubState',
    'MainPID',
    'InvocationID',
    'Job',
    'FragmentPath',
    'DropInPaths',
    'ExecStart',
    'WorkingDirectory',
    'Environment',
    'EnvironmentFiles',
    'UnsetEnvironment',
    'Restart',
    'TimeoutStopUSec',
    'KillMode',
    'NoNewPrivileges',
    'MemoryMax',
    'MemorySwapMax',
    'CPUQuotaPerSecUSec',
    'TasksMax',
  ];
  private processIdentityAtStop: { pid: number; token: string } | undefined;
  private artifact: { release: string; manifest: string } | undefined;
  private readonly config: InspectorConfig;
  constructor(config: InspectorConfig) {
    check(
      config.unit === InspectorService.UNIT && process.getuid?.() === 1000,
      'qualified inspector user service required',
    );
    this.config = config;
  }
  async command(args: string[], timeout = 15000, signal?: AbortSignal): Promise<string> {
    return capture('/usr/bin/systemctl', ['--user', ...args], timeout, signal);
  }
  static fileHash(path: string): string {
    const info = lstatSync(path);
    check(
      isAbsolute(path) &&
        !info.isSymbolicLink() &&
        info.isFile() &&
        info.uid === process.getuid?.() &&
        info.size <= 4 * 1024 * 1024,
      'owned inspector file required',
    );
    return digest(path);
  }
  static processIdentity(pid: number): string | null {
    try {
      const raw = readFileSync(`/proc/${pid}/stat`, 'utf8'),
        tail = raw
          .slice(raw.lastIndexOf(')') + 1)
          .trim()
          .split(/\s+/);
      return text(tail[19]);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
  }
  async inspect(): Promise<InspectorRow> {
    const props: Record<string, string> = Object.fromEntries(
      (
        await this.command([
          'show',
          InspectorService.UNIT,
          ...InspectorService.PROPERTIES.map((name) => `--property=${name}`),
        ])
      )
        .trim()
        .split('\n')
        .map((line) => {
          const equals = line.indexOf('=');
          check(equals >= 0, 'Invalid inspector property');
          return [line.slice(0, equals), line.slice(equals + 1)];
        }),
    );
    check(
      props.Id === InspectorService.UNIT &&
        props.LoadState === 'loaded' &&
        !props.Job &&
        props.Restart === 'no' &&
        props.KillMode === 'control-group' &&
        props.TimeoutStopUSec === 'infinity',
      'inspector drain contract unavailable',
    );
    const active = props.ActiveState,
      sub = props.SubState,
      pid = Number(props.MainPID),
      invocation = text(props.InvocationID);
    for (const key of ['ActiveState', 'SubState', 'MainPID', 'InvocationID']) delete props[key];
    const loaded = /^\{ path=([^;]+) ; argv\[\]=([^;]+) ; ignore_errors=no ; .* \}$/.exec(text(props.ExecStart)),
      release = text(props.WorkingDirectory);
    check(
      loaded &&
        dirname(release) === join(homedir(), 'insignia-artwork-releases') &&
        /^[a-f0-9]{40}$/.test(release.slice(release.lastIndexOf('/') + 1)),
      'immutable inspector command required',
    );
    const manifest = InspectorService.fileHash(join(release, 'manifest.json')),
      expected = `${release}/bin/node ${release}/start.mjs --manifest-sha256 ${manifest}`;
    check(loaded[1] === join(release, 'bin/node') && loaded[2] === expected, 'inspector artifact binding drift');
    props.ExecStart = expected;
    this.artifact = { release, manifest };
    const startup = text(this.config.startupFile),
      storage = text(this.config.storageFile);
    check(props.EnvironmentFiles === `${startup} (ignore_errors=no)`, 'inspector startup binding drift');
    const paths = [
        text(props.FragmentPath),
        ...text(props.DropInPaths).split(/\s+/).filter(Boolean),
        startup,
        storage,
        join(release, 'manifest.json'),
      ],
      files = Object.fromEntries(paths.map((path) => [path, InspectorService.fileHash(path)]));
    for (const path of [startup, storage])
      check((lstatSync(path).mode & 0o077) === 0, 'private inspector custody required');
    const ready = text(this.config.readinessSocket),
      directory = dirname(ready),
      info = lstatSync(directory),
      directoryIdentity = { device: info.dev, inode: info.ino, uid: info.uid, mode: info.mode & 0o777 };
    check(
      ready.endsWith('/ready.sock') &&
        !info.isSymbolicLink() &&
        info.isDirectory() &&
        info.uid === process.getuid?.() &&
        directoryIdentity.mode === 0o700,
      'private inspector socket directory required',
    );
    const hash = createHash('sha256')
      .update(
        canonicalJSON({ properties: props, files, readinessDirectory: directoryIdentity, readinessSocket: ready }),
      )
      .digest('hex');
    const jobs = [
      ...array(
        JSON.parse(
          (await this.command([
            'list-units',
            '--type=service',
            '--state=active,activating,deactivating',
            '--output=json',
            '--no-legend',
            '--no-pager',
          ])) || '[]',
        ),
      ),
      ...array(JSON.parse((await this.command(['list-jobs', '--output=json', '--no-legend', '--no-pager'])) || '[]')),
    ];
    const sandbox = jobs.some((row) => /^insignia-artwork-[a-f0-9-]{36}\.service$/.test(text(record(row).unit)));
    let token: string | null = null;
    let status: 'running' | 'exited';
    if (active === 'active' && sub === 'running' && pid > 0 && /^[a-f0-9]{32}$/.test(invocation)) {
      token = InspectorService.processIdentity(pid);
      check(token !== null, 'inspector process unavailable');
      this.processIdentityAtStop ??= { pid, token };
      status = 'running';
    } else if (active === 'inactive' && sub === 'dead' && pid === 0) {
      check(
        !this.processIdentityAtStop ||
          InspectorService.processIdentity(this.processIdentityAtStop.pid) !== this.processIdentityAtStop.token,
        'inspector process remains after stop',
      );
      status = 'exited';
    } else throw new Error('inspector state unsettled');
    return {
      configSha256: hash,
      status,
      invocation,
      process: { pid, startTicks: token },
      jobs: sandbox,
      socket: existsSync(ready),
    };
  }
  verifyArtifact(): void {
    check(this.artifact, 'inspector artifact not bound');
    verifyInspectorArtifact(this.artifact.release, this.artifact.manifest);
  }
  async ready(): Promise<boolean> {
    return readInspectorReadiness(text(this.config.readinessSocket));
  }
  async stop(signal?: AbortSignal): Promise<void> {
    await this.command(['stop', InspectorService.UNIT], 360000, signal);
  }
  async start(): Promise<void> {
    await this.command(['start', InspectorService.UNIT], 60000);
    const deadline = performance.now() + 45000;
    while (true) {
      const row = await this.inspect();
      if (row.status === 'running' && !row.jobs && (await this.ready())) return;
      check(performance.now() < deadline, 'inspector readiness unavailable after start');
      await delay(500);
    }
  }
}
export async function readInspectorReadiness(path: string): Promise<boolean> {
  try {
    const info = lstatSync(path);
    if (!info.isSocket() || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o600) return false;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (!settled) {
        settled = true;
        request.destroy();
        reject(error);
      }
    };
    const finish = (ready: boolean) => {
      if (!settled) {
        settled = true;
        resolve(ready);
      }
    };
    const request = httpRequest(
      { socketPath: path, path: '/artwork-ready', method: 'GET', timeout: 4000 },
      (response) => {
        response.once('error', fail);
        response.once('aborted', () => fail(new Error('Readiness response aborted')));
        response.once('close', () => {
          if (!response.complete) fail(new Error('Readiness response incomplete'));
        });
        if (response.statusCode !== 200) {
          finish(false);
          response.destroy();
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: unknown) => {
          if (!Buffer.isBuffer(chunk)) {
            const error = new Error('Invalid readiness bytes');
            fail(error);
            request.destroy(error);
            return;
          }
          size += chunk.length;
          if (size > 1024) {
            const error = new Error('Readiness response too large');
            fail(error);
            request.destroy(error);
            return;
          }
          chunks.push(chunk);
        });
        response.once('end', () => {
          try {
            finish(
              canonicalJSON(JSON.parse(Buffer.concat(chunks).toString('utf8'))) === canonicalJSON({ ready: true }),
            );
          } catch (error) {
            fail(error);
          }
        });
      },
    );
    request.once('timeout', () => {
      const error = new Error('Readiness timeout');
      fail(error);
      request.destroy(error);
    });
    request.once('error', fail);
    request.end();
  });
}

export function verify(config: Configuration, item: Container, row: DockerRow): void {
  const labels = record(row.Config.Labels ?? {});
  check(
    row.Id === item.id &&
      row.Image === item.imageId &&
      row.Name === `/${item.name}` &&
      fingerprint(row) === item.configSha256 &&
      labels['com.docker.compose.project'] === (item.project ?? config.project) &&
      labels['com.docker.compose.service'] === item.service,
    'allocated writer identity drift',
  );
}
export function admitJournals(receipts: string): void {
  let inspected = 0;
  for (const name of readdirSync(receipts)) {
    if (!/^[a-f0-9-]{36}$/.test(name)) continue;
    check(++inspected <= 4096, 'prior writer operation requires reconciliation: journal limit');
    const journal = privateDirectory(join(receipts, name));
    if (!readdirSync(journal).some((name) => /^(?:stop|start)-.*\.json$/.test(name))) continue;
    try {
      const read = (name: string) => {
        const path = join(journal, name),
          info = lstatSync(path);
        check(
          !info.isSymbolicLink() &&
            info.isFile() &&
            info.uid === process.getuid?.() &&
            (info.mode & 0o077) === 0 &&
            info.size <= 65536,
          'private journal record required',
        );
        return record(jsonFile(path));
      };
      const preflight = read('preflight.json'),
        resumed = read('resumed.json');
      check(
        preflight.id === name &&
          resumed.id === name &&
          resumed.readiness === 'ORIGINAL_WRITERS_RESUMED' &&
          ['containers', 'original', 'hostInspector', 'inspectorOriginal'].every(
            (key) => canonicalJSON(resumed[key] ?? null) === canonicalJSON(preflight[key] ?? null),
          ),
        'terminal identity mismatch',
      );
    } catch {
      throw new Error('prior writer operation requires reconciliation');
    }
  }
}
export async function execute(
  input: unknown,
  docker: DockerBoundary,
  work: (window: string, stopped: () => Promise<void>) => void | Promise<void>,
  inspector?: InspectorBoundary,
  signal?: AbortSignal,
): Promise<void> {
  sourceEnvironment();
  const config = configuration(input),
    items = config.containers,
    host = config.hostInspector;
  check(
    host ? Boolean(inspector) : !inspector,
    host ? 'qualified host inspector required' : 'unexpected host inspector',
  );
  const runtime = privateDirectory(config.runtimeDirectory),
    receipts = privateDirectory(config.receiptDirectory ?? runtime),
    lock = acquireFileLock(join(receipts, '.operator.lock'));
  try {
    admitJournals(receipts);
    const original: Record<string, { status: string; restarts: number }> = {};
    for (const item of items) {
      const row = await docker.inspect(item);
      verify(config, item, row);
      check(['running', 'exited', 'created'].includes(row.State.Status), 'unsettled writer state');
      check(
        row.State.Status !== 'running' || !item.healthRequired || row.State.Health?.Status === 'healthy',
        'writer health unavailable',
      );
      original[item.id] = { status: row.State.Status, restarts: row.RestartCount };
    }
    const inspectorState = async () => {
      check(host && inspector, 'host inspector required');
      const row = await inspector.inspect();
      check(
        row.configSha256 === host.configSha256 && !row.jobs && ['running', 'exited'].includes(row.status),
        'host inspector identity or settlement drift',
      );
      return row;
    };
    const inspectorOriginal = host ? await inspectorState() : null;
    if (host) {
      check(inspector, 'host inspector required');
      await inspector.verifyArtifact();
      if (inspectorOriginal?.status === 'running') check(await inspector.ready(), 'host inspector not ready');
      check(
        canonicalJSON(await inspectorState()) === canonicalJSON(inspectorOriginal),
        'host inspector changed during preflight',
      );
    }
    const id = randomUUID(),
      journal = join(receipts, id);
    mkdirSync(journal, { mode: 0o700 });
    syncDirectory(receipts);
    const preflight = { id, containers: items, original, hostInspector: host ?? null, inspectorOriginal };
    durable(join(journal, 'preflight.json'), preflight);
    const windowPath = join(runtime, 'window.json');
    try {
      lstatSync(windowPath);
      throw new Error('stale exclusion requires operator inspection');
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    const attempted: Container[] = [],
      uncertain = new Set<string>();
    let inspectorAttempted = false,
      inspectorUncertain = false;
    const inspectorStopped = async () => {
      try {
        const row = await inspectorState();
        check(
          row.status === 'exited' &&
            !row.socket &&
            (row.invocation === '' || row.invocation === inspectorOriginal?.invocation),
          'host inspector resumed during exclusion',
        );
      } catch (error) {
        inspectorUncertain = true;
        throw error;
      }
    };
    const stopped = async () => {
      for (const item of items) {
        const row = await docker.inspect(item);
        verify(config, item, row);
        check(
          ['exited', 'created'].includes(row.State.Status) && row.RestartCount === original[item.id]?.restarts,
          'writer resumed or restarted during exclusion',
        );
      }
      if (host) await inspectorStopped();
    };
    let workFailure: unknown;
    let workFailed = false;
    let resumeErrors: string[] = [];
    try {
      signal?.throwIfAborted();
      for (const item of items) {
        if (original[item.id]?.status === 'running') {
          durable(join(journal, `stop-${item.service}.json`), { id: item.id, action: 'STOP_INTENDED' });
          attempted.push(item);
          try {
            await docker.stop(item, signal);
          } catch (error) {
            uncertain.add(item.id);
            throw error;
          }
          durable(join(journal, `stopped-${item.service}.json`), { id: item.id, action: 'STOP_ACKNOWLEDGED' });
        }
      }
      signal?.throwIfAborted();
      if (host && inspectorOriginal?.status === 'running') {
        check(inspector, 'host inspector required');
        inspectorUncertain = true;
        await inspector.verifyArtifact();
        check(
          canonicalJSON(await inspectorState()) === canonicalJSON(inspectorOriginal),
          'host inspector replaced before stop',
        );
        durable(join(journal, 'stop-host-inspector.json'), {
          action: 'STOP_INTENDED',
          invocation: inspectorOriginal.invocation,
        });
        inspectorAttempted = true;
        await inspector.stop(signal);
        inspectorUncertain = false;
        await inspectorStopped();
        durable(join(journal, 'stopped-host-inspector.json'), { action: 'STOP_ACKNOWLEDGED' });
      }
      await stopped();
      signal?.throwIfAborted();
      const now = Date.now();
      durable(windowPath, {
        id,
        startedAt: new Date(now).toISOString(),
        until: new Date(now + config.windowSeconds * 1000).toISOString(),
      });
      await work(windowPath, stopped);
      await stopped();
      durable(join(journal, 'backup-completed.json'), { completedAt: new Date().toISOString() });
    } catch (error) {
      workFailure = error;
      workFailed = true;
    } finally {
      if (existsSync(windowPath)) {
        remove(windowPath);
        syncDirectory(runtime);
      }
      const errors: string[] = [];
      if (host) {
        try {
          check(inspector, 'host inspector required');
          check(!inspectorUncertain, 'host inspector needs settlement');
          if (inspectorAttempted) {
            await inspector.verifyArtifact();
            await inspectorStopped();
            durable(join(journal, 'start-host-inspector.json'), { action: 'START_INTENDED' });
            await inspector.start();
            const row = await inspectorState();
            check(
              row.status === 'running' && row.invocation !== inspectorOriginal?.invocation && (await inspector.ready()),
              'host inspector resume not ready',
            );
          } else
            check(
              canonicalJSON(await inspectorState()) === canonicalJSON(inspectorOriginal),
              'untouched host inspector drift',
            );
        } catch {
          errors.push('host-inspector');
        }
      }
      for (const item of [...attempted].reverse()) {
        if (errors.includes('host-inspector') || uncertain.has(item.id)) {
          errors.push(item.service);
          continue;
        }
        try {
          let row = await docker.inspect(item);
          verify(config, item, row);
          check(row.RestartCount === original[item.id]?.restarts, 'restart drift; manual settlement required');
          if (row.State.Status === 'exited') {
            durable(join(journal, `start-${item.service}.json`), { id: item.id, action: 'START_INTENDED' });
            await docker.start(item);
          }
          const deadline = performance.now() + 45000;
          while (true) {
            row = await docker.inspect(item);
            verify(config, item, row);
            check(row.RestartCount === original[item.id]?.restarts, 'resume restart drift');
            if (row.State.Status === 'running' && (!item.healthRequired || row.State.Health?.Status === 'healthy'))
              break;
            check(performance.now() < deadline, 'writer did not recover');
            await delay(500);
          }
        } catch {
          errors.push(item.service);
        }
      }
      resumeErrors = errors;
    }
    if (resumeErrors.length) {
      durable(join(journal, 'resume-hold.json'), { readiness: 'HOLD_OPERATOR_SETTLEMENT', services: resumeErrors });
      throw new Error('writer resume needs operator settlement');
    }
    durable(join(journal, 'resumed.json'), { ...preflight, readiness: 'ORIGINAL_WRITERS_RESUMED' });
    if (workFailed) throw workFailure;
  } finally {
    lock.close();
  }
}
async function childDuringExclusion(
  argv: string[],
  window: string,
  stopped: () => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  const [command, ...args] = argv;
  check(command, 'Snapshot command required');
  const deadline = timestamp(record(jsonFile(window)).until);
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  let ended = false,
    code: number | null = null;
  const completion = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (value) => {
      ended = true;
      code = value;
      resolve();
    });
  });
  try {
    while (!ended) {
      signal.throwIfAborted();
      await stopped();
      check(Date.now() < deadline, 'exclusion budget exhausted');
      await Promise.race([completion, delay(500)]);
    }
    await completion;
    check(code === 0, 'snapshot/backup failed');
  } catch (error) {
    if (child.pid && !ended) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {}
      await Promise.race([completion.catch(() => {}), delay(5000)]);
      if (!ended) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {}
        await completion.catch(() => {});
      }
    }
    throw error;
  }
}
export async function runOffhostReplica(argv: readonly string[], signal: AbortSignal): Promise<void> {
  const [command, ...args] = argv;
  check(command, 'Replica command required');
  signal.throwIfAborted();
  await capture(command, args, 3600000, signal);
  signal.throwIfAborted();
}
export async function main(argv = process.argv.slice(2)): Promise<void> {
  process.umask(0o077);
  const controller = new AbortController(),
    interrupted = () => controller.abort(new Error('operator interrupted'));
  process.on('SIGTERM', interrupted);
  try {
    const path = text(argv[0]),
      info = lstatSync(path);
    check(
      !info.isSymbolicLink() &&
        info.isFile() &&
        info.uid === process.getuid?.() &&
        (info.mode & 0o077) === 0 &&
        info.size <= 16384,
      'private reviewed configuration required',
    );
    const raw = record(jsonFile(path));
    check('promisedCleanupAt' in raw, 'explicit promised cleanup policy required');
    if (raw.promisedCleanupAt !== null)
      check(timestamp(raw.promisedCleanupAt) > Date.now(), 'promised cleanup cutoff expired or invalid');
    process.env.BACKUP_PROMISED_CLEANUP_AT = raw.promisedCleanupAt === null ? 'none' : text(raw.promisedCleanupAt);
    check(raw.receiptDirectory, 'durable operator journal directory required');
    check(!raw.replicaRequired || raw.replicaConfig, 'required off-host replica configuration missing');
    const config = configuration(raw),
      runtime = privateDirectory(config.runtimeDirectory);
    check(readdirSync(runtime).length === 0, 'interrupted runtime requires operator inspection');
    requireTmpfs(runtime);
    const work = async (window: string, stopped: () => Promise<void>) => {
      const objects = join(runtime, 'objects');
      mkdirSync(objects, { mode: 0o700 });
      const manifest = join(runtime, 'objects.json'),
        node = text(raw.node);
      for (const argv of [
        [node, new URL('./backup-snapshot.mjs', import.meta.url).pathname, objects, manifest, window],
        [
          node,
          new URL('./backup.mts', import.meta.url).pathname,
          'create',
          '--store',
          text(raw.store),
          '--scratch',
          join(runtime, 'scratch'),
          '--objects',
          objects,
          '--object-manifest',
          manifest,
          '--recipient',
          text(raw.recipient),
          '--pg-dump',
          text(raw.pgDump),
        ],
      ])
        await childDuringExclusion(argv, window, stopped, controller.signal);
    };
    const inspector = config.hostInspector ? new InspectorService(config.hostInspector) : undefined;
    await execute(config, new Docker(text(raw.docker)), work, inspector, controller.signal);
    controller.signal.throwIfAborted();
    const offhost = Boolean(raw.replicaConfig);
    if (offhost)
      await runOffhostReplica(
        [
          text(raw.node),
          new URL('./backup-replica.mjs', import.meta.url).pathname,
          'replicate',
          text(raw.replicaConfig),
        ],
        controller.signal,
      );
    controller.signal.throwIfAborted();
    console.log(
      JSON.stringify({
        backupRunCompleted: true,
        offhostReplicated: offhost,
        readiness: offhost ? 'OFFHOST_CIPHERTEXT_VERIFIED' : 'LOCAL_BACKUP_ONLY_OFFHOST_UNCONFIGURED',
      }),
    );
  } catch {
    console.log(JSON.stringify({ backupRunCompleted: false, readiness: 'HOLD_OPERATOR_INSPECTION' }));
    process.exitCode = 1;
  } finally {
    process.off('SIGTERM', interrupted);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
