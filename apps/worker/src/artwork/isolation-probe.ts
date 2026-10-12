/** Deployment qualification helper. This never processes uploaded artwork. */
import { existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';

process.stderr.write('INSIGNIA_INSPECTION_STARTED\n');
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const request = JSON.parse(Buffer.concat(chunks).toString()) as {
  mode: string;
  port?: number;
  path?: string;
  marker?: string;
};
if (request.mode === 'hang')
  await new Promise(() => {
    setInterval(() => {}, 1000);
  });
else if (request.mode === 'tree') {
  const { spawn } = await import('node:child_process');
  spawn('/node', ['-e', `setInterval(()=>{},1000); // ${request.marker}`], { stdio: 'ignore' });
  await new Promise(() => {
    setInterval(() => {}, 1000);
  });
} else if (request.mode === 'cpu') {
  while (true) {
    Math.sqrt(Math.random());
  }
} else if (request.mode === 'memory') {
  const retained: Buffer[] = [];
  while (true) {
    const block = Buffer.alloc(8 * 1024 * 1024, 255);
    retained.push(block);
  }
} else {
  const network = await new Promise<boolean>((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: request.port ?? 9 });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
  let writable = false;
  try {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(new URL('./isolation-write', import.meta.url), 'x');
    writable = true;
  } catch {}
  process.stdout.write(
    JSON.stringify({
      hostFileVisible: existsSync(request.path ?? '/etc/passwd'),
      network,
      writable,
      limits: readFileSync('/proc/self/limits', 'utf8'),
      status: readFileSync('/proc/self/status', 'utf8'),
    }),
  );
}
