import { type ChildProcess, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { stripVTControlCharacters } from 'node:util';

export type BuiltProcess = {
  /** The loopback origin the process reported after binding, e.g. `http://127.0.0.1:41234`. */
  url: string;
  child: ChildProcess;
  closed: Promise<unknown>;
  output(): string;
  /** SIGTERM, then SIGKILL after 5 s; resolves once the process has closed. */
  stop(): Promise<void>;
};

const entries = {
  web: new URL('../../dist/server/entry.mjs', import.meta.url),
  worker: new URL('../../../worker/dist/main.js', import.meta.url),
};

function reportedUrl(kind: keyof typeof entries, stdout: string): string | undefined {
  if (kind === 'web')
    return stripVTControlCharacters(stdout).match(/Server listening on (http:\/\/127\.0\.0\.1:\d+)\r?\n/)?.[1];
  for (const line of stdout.split('\n').slice(0, -1)) {
    try {
      const value: unknown = JSON.parse(line);
      if (value && typeof value === 'object' && 'url' in value && typeof value.url === 'string') return value.url;
    } catch {
      /* not the address line */
    }
  }
}

/**
 * Starts the built web server or worker on a port the OS assigns and resolves with the address it
 * reports. A port picked by the test can already be in use on a busy runner: the built web server
 * then exits 0 without output, and a concurrent test can reach another test's process.
 */
export async function startBuilt(
  kind: keyof typeof entries,
  env: NodeJS.ProcessEnv,
  { reportWithinMs = 30_000 } = {},
): Promise<BuiltProcess> {
  const child = spawn(
    process.execPath,
    kind === 'web' ? [entries.web.pathname] : [entries.worker.pathname, '--port=0'],
    {
      cwd: new URL('../..', import.meta.url),
      env: kind === 'web' ? { ...env, HOST: '127.0.0.1', PORT: '0', ASTRO_NODE_LOGGING: 'enabled' } : env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const closed = new Promise((resolve) => child.once('close', resolve));
  let url: string | undefined;
  let stdout = '';
  let stderr = '';
  child.on('error', (error) => {
    stderr += error.message;
  });
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    stdout += chunk;
    url ??= reportedUrl(kind, stdout);
    // Keep draining the pipe; retain only a bounded tail for diagnostics once the address is known.
    if (url) stdout = stdout.slice(-8192);
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-8192);
  });
  const output = () => `${stdout}${stderr}`;
  async function stop() {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await Promise.race([closed, delay(5000)]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    await closed;
  }
  const deadline = Date.now() + reportWithinMs;
  while (!url) {
    if (child.exitCode !== null || child.signalCode !== null || Date.now() > deadline) {
      await stop();
      throw new Error(
        `built ${kind} did not report its address: ${JSON.stringify({
          exitCode: child.exitCode,
          signalCode: child.signalCode,
          output: output().slice(-2000),
        })}`,
      );
    }
    await delay(50);
  }
  return { url, child, closed, output, stop };
}
