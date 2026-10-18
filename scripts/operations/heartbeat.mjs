import { randomUUID } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const knownCount = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000;
const unknown = () => ({ status: 'unknown', count: 0 });

// Input files contain only aggregates. No database credentials/customer records cross this boundary.
export async function collectHeartbeat({
  now = Date.now(),
  eventId = randomUUID(),
  backupMaxAgeSeconds,
  probeAvailability,
  readAggregate,
}) {
  if (!Number.isSafeInteger(backupMaxAgeSeconds) || backupMaxAgeSeconds < 60 || backupMaxAgeSeconds > 604_800)
    throw new Error('Backup age policy required');
  const signals = { availability: unknown(), backup: unknown(), processing: unknown(), deletion: unknown() };
  try {
    const ready = await probeAvailability();
    if (typeof ready === 'boolean') signals.availability = { status: ready ? 'ok' : 'problem', count: ready ? 0 : 1 };
  } catch {
    /* An unavailable observation is unknown, never healthy. */
  }
  for (const kind of ['backup', 'processing', 'deletion']) {
    try {
      const snapshot = await readAggregate(kind);
      if (kind === 'backup') {
        const completed = snapshot?.completedAt;
        if (Number.isSafeInteger(completed) && completed >= 0 && completed <= now) {
          const stale = now - completed > backupMaxAgeSeconds * 1000;
          signals.backup = { status: stale ? 'problem' : 'ok', count: stale ? 1 : 0 };
        }
      } else if (
        Number.isSafeInteger(snapshot?.observedAt) &&
        snapshot.observedAt <= now &&
        now - snapshot.observedAt <= 120_000
      ) {
        const count = snapshot[kind === 'processing' ? 'stalledCount' : 'overdueCount'];
        if (knownCount(count)) signals[kind] = { status: count ? 'problem' : 'ok', count };
      }
    } catch {
      /* Missing/malformed/stale source stays explicit. */
    }
  }
  return { version: 1, eventId, timestamp: now, signals };
}

export async function sendHeartbeat({ endpoint, secret, payload, fetch: request = globalThis.fetch }) {
  const base = new URL(endpoint);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/')
    throw new Error('HTTPS relay origin required');
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 128 || !/^[!-~]+$/.test(secret))
    throw new Error('Invalid relay credential');
  const response = await request(`${base.origin}/v1/heartbeat`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const ok = response.ok;
  await response.body?.cancel();
  if (!ok) throw new Error('Heartbeat not acknowledged');
}

async function readSmallJson(path) {
  const file = await open(path, 'r');
  try {
    if ((await file.stat()).size > 4096) throw new Error('Oversized aggregate');
    const bytes = Buffer.alloc(4097);
    const { bytesRead } = await file.read(bytes);
    if (bytesRead > 4096) throw new Error('Oversized aggregate');
    return JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
  } finally {
    await file.close();
  }
}

async function run() {
  const config = await readSmallJson(process.env.INSIGNIA_HEARTBEAT_CONFIG ?? '/run/insignia/heartbeat.json');
  const info = await lstat(config.secretFile);
  if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600 || info.size > 128)
    throw new Error('Protected relay credential required');
  const file = await open(config.secretFile, 'r');
  let secret;
  try {
    secret = (await file.readFile('utf8')).trim();
  } finally {
    await file.close();
  }
  const probe = config.availabilityProbe;
  if (probe !== undefined) {
    const url = new URL(probe);
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.pathname !== '/ready' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Loopback /ready probe required');
  }
  const once = async () => {
    const payload = await collectHeartbeat({
      backupMaxAgeSeconds: config.backupMaxAgeSeconds,
      probeAvailability: async () => {
        if (!probe) return null;
        const response = await fetch(probe, { redirect: 'error', signal: AbortSignal.timeout(5000) });
        const ready = response.status === 200;
        await response.body?.cancel();
        return ready;
      },
      readAggregate: (kind) => (config.aggregateFiles?.[kind] ? readSmallJson(config.aggregateFiles[kind]) : null),
    });
    await sendHeartbeat({ endpoint: config.endpoint, secret, payload });
  };
  do {
    try {
      await once();
      process.stdout.write('heartbeat_acknowledged\n');
    } catch {
      process.stderr.write('heartbeat_unacknowledged\n');
      if (!process.argv.includes('--loop')) process.exitCode = 1;
    }
    if (!process.argv.includes('--loop')) break;
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  } while (process.argv.includes('--loop'));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(() => {
    process.stderr.write('heartbeat_configuration_failed\n');
    process.exitCode = 1;
  });
}
