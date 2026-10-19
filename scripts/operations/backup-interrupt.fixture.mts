import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { text } from './backup-files.mts';
import { Docker, execute } from './backup-run.mts';

const directory = text(process.argv[2]),
  controller = new AbortController();
const interrupted = () => controller.abort(new Error('operator interrupted'));
process.on('SIGTERM', interrupted);
try {
  const config: unknown = JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8'));
  await execute(
    config,
    new Docker(join(directory, 'docker')),
    async () => {
      const timer = setInterval(() => {}, 1000);
      try {
        await new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
          process.stdout.write('CAPTURE_READY');
        });
      } finally {
        clearInterval(timer);
      }
    },
    undefined,
    controller.signal,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Synthetic interruption');
  process.exitCode = 1;
} finally {
  process.off('SIGTERM', interrupted);
}
