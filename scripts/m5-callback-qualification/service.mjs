// Experimental loopback service. Signing material comes from private inherited FD3, never env/logs.
import './network-guard.mjs';
import fs from 'node:fs';

const emit = process.stdout.write.bind(process.stdout);
process.stdout.write = () => true;
process.stderr.write = () => true;
for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir']) console[method] = () => {};
const fail = () => {
  emit('{"status":"REFUSED"}\n');
  process.exit(20);
};
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
try {
  const { openReceiver } = await import('./receiver.mjs');
  const raw = Buffer.alloc(4097);
  let size = 0;
  while (size < raw.length) {
    const count = fs.readSync(3, raw, size, raw.length - size, null);
    if (count === 0) break;
    size += count;
  }
  if (size > 4096) throw Error('INPUT');
  const clientSecrets = JSON.parse(raw.subarray(0, size).toString('utf8'));
  raw.fill(0);
  const receiver = await openReceiver({
    directory: process.argv[2],
    clientSecrets,
    port: Number(process.argv[3] ?? 0),
  });
  emit(JSON.stringify({ status: 'READY', port: receiver.port }) + '\n');
  let closing = false;
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, async () => {
      if (closing) return;
      closing = true;
      await receiver.close();
      process.exit(0);
    });
} catch {
  fail();
}
