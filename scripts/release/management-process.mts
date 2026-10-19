import type { EventEmitter } from 'node:events';
import type { Reservation } from './collector.mts';
import { required } from './validation.mts';
export interface ManagementChild extends EventEmitter {
  stdin: { write(value: string): unknown; end(): unknown };
  stdout: EventEmitter;
  exitCode: number | null;
  kill(signal: NodeJS.Signals): unknown;
}
export type ManagementSpawn = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; stdio: ['pipe', 'pipe', 'ignore'] },
) => ManagementChild;

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { releaseProfile } from './profiles.mts';

/** One fixed child, no credential stdin/argv. Official noPrompt SDK session and
 * cache maintenance remain in that original SDK process, not the web/runtime. */
export function createManagementProcess({
  deadline,
  now = Date.now,
  spawnChild = (command, args, options) => spawn(command, args, options),
  environment = process.env,
  profileName,
}: {
  deadline: number;
  now?: () => number;
  spawnChild?: ManagementSpawn;
  environment?: NodeJS.ProcessEnv;
  profileName?: string;
}) {
  releaseProfile(profileName);
  let child: ManagementChild | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    bytes = 0,
    pending = '',
    stopped = false;
  const messages: string[] = [];
  const waiting: { resolve(value: string): void; reject(error: Error): void }[] = [];
  let exit: Promise<boolean> | undefined;
  const fail = () => {
    stopped = true;
    for (const waiter of waiting.splice(0)) waiter.reject(new Error('Management read unavailable'));
    child?.kill('SIGKILL');
  };
  const next = () => {
    if (stopped) return Promise.reject(new Error('Management read unavailable'));
    if (messages.length) return Promise.resolve(required(messages.shift()));
    return new Promise<string>((resolve, reject) => waiting.push({ resolve, reject }));
  };
  async function result(kind: 'OPEN' | 'CLOSE', reserve: Reservation): Promise<unknown> {
    for (;;) {
      const line = await next();
      if (line.startsWith('RESERVE ')) {
        const operation = line.slice(8);
        assert.ok(['ActiveAppReleaseFromApiKey', 'AppVersions', 'AppVersionByTag'].includes(operation));
        assert.equal((await reserve(operation)).durable, true);
        required(child).stdin.write('DURABLE_ACK\n');
      } else {
        assert.ok(line.startsWith(`${kind} `));
        const value: unknown = JSON.parse(line.slice(kind.length + 1));
        return value;
      }
    }
  }
  return {
    async authenticate() {
      assert.ok(!child && deadline > now());
      const env: NodeJS.ProcessEnv = {};
      for (const name of ['HOME', 'PATH', 'LANG', 'LC_ALL', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'TERM'])
        if (environment[name] !== undefined) env[name] = environment[name];
      child = spawnChild(
        process.execPath,
        [fileURLToPath(new URL('./management-worker.mts', import.meta.url)), ...(profileName ? [profileName] : [])],
        { env, stdio: ['pipe', 'pipe', 'ignore'] },
      );
      timer = setTimeout(fail, deadline - now());
      child.stdout.on('data', (chunk: unknown) => {
        if (!Buffer.isBuffer(chunk)) {
          fail();
          return;
        }
        bytes += chunk.length;
        if (bytes > 1048576) {
          fail();
          return;
        }
        try {
          pending += new TextDecoder('utf-8', { fatal: true }).decode(chunk);
        } catch {
          fail();
          return;
        }
        for (;;) {
          const newline = pending.indexOf('\n');
          if (newline < 0) break;
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          if (line === 'STOP') {
            fail();
            return;
          }
          const waiter = waiting.shift();
          if (waiter) waiter.resolve(line);
          else messages.push(line);
        }
      });
      exit = new Promise<boolean>((resolve) => {
        required(child).once('error', () => {
          fail();
          resolve(false);
        });
        required(child).once('close', (code, signal) => {
          clearTimeout(timer);
          const good = code === 0 && !signal && !pending;
          if (!good || waiting.length) fail();
          resolve(good);
        });
      });
      child.stdin.write('AUTHENTICATE\n');
      assert.equal(await next(), 'AUTHENTICATED');
    },
    async open(reserve: Reservation) {
      required(child).stdin.write('OPEN\n');
      return result('OPEN', reserve);
    },
    async close(reserve: Reservation) {
      required(child).stdin.write('CLOSE\n');
      const value = await result('CLOSE', reserve);
      required(child).stdin.end();
      assert.equal(await required(exit), true);
      assert.equal(messages.length, 0);
      return value;
    },
    shutdown() {
      clearTimeout(timer);
      if (child && !child.exitCode) child.kill('SIGKILL');
    },
  };
}
