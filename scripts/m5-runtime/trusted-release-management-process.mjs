import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { releaseProfile } from './release-profile.mjs';

/** One fixed child, no credential stdin/argv. Official noPrompt SDK session and
 * cache maintenance remain in that original SDK process, not the web/runtime. */
export function createManagementProcess({
  deadline,
  now = Date.now,
  spawnChild = spawn,
  environment = process.env,
  profileName,
}) {
  releaseProfile(profileName);
  let child,
    timer,
    bytes = 0,
    pending = '',
    stopped = false;
  const messages = [],
    waiting = [];
  let exit;
  const fail = () => {
    stopped = true;
    for (const waiter of waiting.splice(0)) waiter.reject(new Error('Management read unavailable'));
    child?.kill('SIGKILL');
  };
  const next = () => {
    if (stopped) return Promise.reject(new Error('Management read unavailable'));
    if (messages.length) return Promise.resolve(messages.shift());
    return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
  };
  async function result(kind, reserve) {
    for (;;) {
      const line = await next();
      if (line.startsWith('RESERVE ')) {
        const operation = line.slice(8);
        assert.ok(['ActiveAppReleaseFromApiKey', 'AppVersions', 'AppVersionByTag'].includes(operation));
        assert.equal((await reserve(operation)).durable, true);
        child.stdin.write('DURABLE_ACK\n');
      } else {
        assert.ok(line.startsWith(`${kind} `));
        return JSON.parse(line.slice(kind.length + 1));
      }
    }
  }
  return {
    async authenticate() {
      assert.ok(!child && deadline > now());
      const env = {};
      for (const name of ['HOME', 'PATH', 'LANG', 'LC_ALL', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'TERM'])
        if (environment[name] !== undefined) env[name] = environment[name];
      child = spawnChild(
        process.execPath,
        [
          fileURLToPath(new URL('./trusted-release-management-worker.mjs', import.meta.url)),
          ...(profileName ? [profileName] : []),
        ],
        { env, stdio: ['pipe', 'pipe', 'ignore'] },
      );
      timer = setTimeout(fail, deadline - now());
      child.stdout.on('data', (chunk) => {
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
      exit = new Promise((resolve) => {
        child.once('error', () => {
          fail();
          resolve(false);
        });
        child.once('close', (code, signal) => {
          clearTimeout(timer);
          const good = code === 0 && !signal && !pending;
          if (!good || waiting.length) fail();
          resolve(good);
        });
      });
      child.stdin.write('AUTHENTICATE\n');
      assert.equal(await next(), 'AUTHENTICATED');
    },
    async open(reserve) {
      child.stdin.write('OPEN\n');
      return result('OPEN', reserve);
    },
    async close(reserve) {
      child.stdin.write('CLOSE\n');
      const value = await result('CLOSE', reserve);
      child.stdin.end();
      assert.equal(await exit, true);
      assert.equal(messages.length, 0);
      return value;
    },
    shutdown() {
      clearTimeout(timer);
      if (child && !child.exitCode) child.kill('SIGKILL');
    },
  };
}
