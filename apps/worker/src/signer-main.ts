import { chmod, lstat, unlink } from 'node:fs/promises';
import { SIGNER_SOCKET, SIGNER_SOCKET_DIRECTORY, SigningKeyLifecycle } from '@insignia/application';
import { createSignerKeyStore } from '@insignia/database';
import { Pool } from 'pg';
import { loadSigningWrapKeys } from './signer/ring.js';
import { createSignerServer, type SignerAuditEntry } from './signer/server.js';

/**
 * Separate signer process. It alone holds the signing wrapping keys (a read-only 0600 file) and a
 * database role that can read private envelopes. It serves the web runtime on a Unix socket in an
 * owner-only directory; it has no TCP listener and no proxy route.
 *   node dist/signer-main.js           serve
 *   node dist/signer-main.js --rewrap  re-seal every pending/active envelope under the current KEK, then exit
 */
const line = (value: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(value)}\n`);

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const ring = loadSigningWrapKeys();
  const pool = new Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 5000,
    options: '-c statement_timeout=5000ms -c lock_timeout=3000ms',
  });
  const signer = createSignerKeyStore(pool);
  const wipe = () => {
    for (const key of Object.values(ring.keys)) key.fill(0);
  };
  if (process.argv.includes('--rewrap')) {
    const lifecycle = new SigningKeyLifecycle(signer.store, ring);
    let rewrapped = 0,
      current = 0,
      skipped = 0;
    try {
      for (const target of await signer.privateHalfScopes()) {
        const scope = await signer.store.getActiveScope(target.shopId, target.installationGeneration);
        if (!scope) {
          skipped += 1;
          continue;
        }
        for (const key of await signer.store.list(scope)) {
          if (key.state !== 'pending' && key.state !== 'active') continue;
          const result = await lifecycle.rewrap(scope, key.id);
          if (!result) skipped += 1;
          else if (result.from === result.to) current += 1;
          else rewrapped += 1;
        }
      }
      line({ event: 'signer_rewrap', rewrapped, current, skipped, currentKeyId: ring.currentKeyId });
    } finally {
      wipe();
      await signer.close();
    }
    return;
  }
  const directory = await lstat(SIGNER_SOCKET_DIRECTORY);
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    directory.uid !== process.getuid?.() ||
    (directory.mode & 0o777) !== 0o700
  )
    throw new Error('Signer socket directory custody is invalid');
  try {
    const existing = await lstat(SIGNER_SOCKET);
    if (!existing.isSocket()) throw new Error('Signer socket path is occupied');
    await unlink(SIGNER_SOCKET);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const counts = new Map<string, number>();
  const server = createSignerServer({
    store: signer.store,
    ring,
    audit(entry: SignerAuditEntry) {
      line({ ...entry, event: `signer_${entry.event}` });
      const key = `${entry.event}:${entry.outcome}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(SIGNER_SOCKET, () => resolve());
  });
  await chmod(SIGNER_SOCKET, 0o600);
  line({ event: 'signer_listening', currentKeyId: ring.currentKeyId, keyCount: Object.keys(ring.keys).length });
  const summary = setInterval(() => {
    if (counts.size === 0) return;
    line({ event: 'signer_counts', counts: Object.fromEntries(counts) });
    counts.clear();
  }, 3_600_000);
  summary.unref();
  await new Promise<void>((resolve) => {
    process.once('SIGTERM', () => resolve());
    process.once('SIGINT', () => resolve());
  });
  clearInterval(summary);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  wipe();
  await signer.close();
}

main().catch(() => {
  line({ event: 'signer_stopped', errorClass: 'SignerStartupError' });
  process.exitCode = 1;
});
