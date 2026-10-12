import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ArtworkInspectionError } from './errors.js';
import { inspectionRuntimeMounts } from './runtime-mounts.js';

const directory = dirname(fileURLToPath(import.meta.url));
/** Linux-only: no unisolated fallback. Each job gets a cgroup and fresh network/mount/PID namespaces. */
export async function runArtworkSandbox(
  entry: 'child.js' | 'isolation-probe.js',
  input: Uint8Array,
  signal?: AbortSignal,
): Promise<Buffer> {
  if (signal?.aborted) throw new ArtworkInspectionError('ABORTED', 'Artwork inspection aborted');
  const packageRoot = resolve(directory, '../..');
  const unit = `insignia-artwork-${randomUUID()}`;
  let mounts: string[];
  try {
    mounts = inspectionRuntimeMounts();
  } catch {
    throw new ArtworkInspectionError('UNAVAILABLE', 'Artwork runtime dependency unavailable');
  }
  const env = {
    PATH: '/usr/bin:/bin',
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.()}`,
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
  };
  const args = [
    '--user',
    '--quiet',
    '--wait',
    '--pipe',
    `--unit=${unit}`,
    '--property=MemoryMax=256M',
    '--property=MemorySwapMax=0',
    '--property=OOMPolicy=kill',
    '--property=CPUQuota=100%',
    '--property=LimitCPU=8:9',
    '--property=TasksMax=16',
    '--property=RuntimeMaxSec=10s',
    '--property=KillMode=control-group',
    '--property=TimeoutStopSec=1s',
    '--property=NoNewPrivileges=yes',
    '/usr/bin/bwrap',
    '--unshare-all',
    '--die-with-parent',
    '--new-session',
    '--cap-drop',
    'ALL',
    '--clearenv',
    '--setenv',
    'PATH',
    '/usr/bin',
    '--setenv',
    'VIPS_CONCURRENCY',
    '1',
    '--setenv',
    'UV_THREADPOOL_SIZE',
    '1',
    '--ro-bind',
    '/usr/lib',
    '/usr/lib',
    '--ro-bind',
    '/lib',
    '/lib',
    '--ro-bind',
    '/lib64',
    '/lib64',
    '--ro-bind',
    realpathSync(process.execPath),
    '/node',
    ...mounts,
    '--ro-bind',
    resolve(packageRoot, 'package.json'),
    '/runtime/package.json',
    '--ro-bind',
    directory,
    '/runtime/artwork',
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--tmpfs',
    '/tmp',
    '--chdir',
    '/tmp',
    '/node',
    '--max-old-space-size=128',
    `/runtime/artwork/${entry}`,
  ];
  return new Promise((resolveResult, reject) => {
    const child = spawn('/usr/bin/systemd-run', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let failure: ArtworkInspectionError | undefined;
    let started = false;
    let diagnostics = '';
    let launcherDeadline: NodeJS.Timeout | undefined;
    const stop = (error: ArtworkInspectionError) => {
      if (failure) return;
      failure = error;
      launcherDeadline = setTimeout(() => child.kill('SIGKILL'), 1000);
      spawn('/usr/bin/systemctl', ['--user', 'stop', `${unit}.service`], {
        stdio: 'ignore',
        env,
      }).on('error', () => {});
    };
    const abort = () => stop(new ArtworkInspectionError('ABORTED', 'Artwork inspection aborted'));
    const timer = setTimeout(
      () => stop(new ArtworkInspectionError(started ? 'REJECTED' : 'UNAVAILABLE', 'Artwork inspection timed out')),
      10_000,
    );
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024)
        stop(new ArtworkInspectionError(started ? 'REJECTED' : 'UNAVAILABLE', 'Artwork output limit'));
      else chunks.push(chunk);
    });
    // Never echo host diagnostics or untrusted input into application logs.
    child.stderr.on('data', (chunk: Buffer) => {
      if (diagnostics.length < 1024) diagnostics += chunk.toString();
      if (diagnostics.includes('INSIGNIA_INSPECTION_STARTED\n')) started = true;
    });
    child.stdin.on('error', () => {});
    child.on('error', () => {
      failure ??= new ArtworkInspectionError('UNAVAILABLE', 'Artwork sandbox unavailable');
    });
    child.on('close', async (code) => {
      clearTimeout(timer);
      clearTimeout(launcherDeadline);
      signal?.removeEventListener('abort', abort);
      if (code === 0 && !failure) {
        resolveResult(Buffer.concat(chunks));
        return;
      }
      try {
        if (!failure && code === 65 && started)
          failure = new ArtworkInspectionError('REJECTED', 'Artwork rejected by inspection policy');
        if (!failure && started) {
          const { stdout } = await promisify(execFile)(
            '/usr/bin/systemctl',
            ['--user', 'show', `${unit}.service`, '--property=Result', '--property=ExecMainStatus'],
            { env, timeout: 1000 },
          );
          if (
            /^Result=(oom-kill|timeout)$/m.test(stdout) ||
            (/^Result=signal$/m.test(stdout) && /^ExecMainStatus=24$/m.test(stdout)) ||
            (/^Result=exit-code$/m.test(stdout) && /^ExecMainStatus=152$/m.test(stdout))
          ) {
            failure = new ArtworkInspectionError('REJECTED', 'Artwork inspection resource limit');
          }
        }
      } catch {
        /* Unresolved host failures remain infrastructure failures. */
      } finally {
        try {
          await promisify(execFile)('/usr/bin/systemctl', ['--user', 'reset-failed', `${unit}.service`], {
            env,
            timeout: 1000,
          });
        } catch {}
      }
      reject(failure ?? new ArtworkInspectionError('UNAVAILABLE', 'Artwork sandbox unavailable'));
    });
    child.stdin.end(input);
  });
}
