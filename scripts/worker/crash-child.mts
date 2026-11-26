// Isolated test process only. Production queue and durable handlers; no provider transport.
import { createRequire } from 'node:module';
import { createDurableWorkerHandlers } from '../../apps/worker/dist/handlers.js';
import { createPgBossRuntime } from '../../apps/worker/dist/runtime.js';
import { createDurableCore } from '../../packages/database/dist/index.js';

const { Pool }: typeof import('pg') = createRequire(new URL('../../apps/worker/package.json', import.meta.url))('pg');
const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
const queue = createPgBossRuntime({
  webhookHandoff: core.webhooks,
  connectionString: process.env.DATABASE_URL,
  credentialKeysReady: true,
});
const handlers = createDurableWorkerHandlers(core, {
  async refresh() {
    throw new Error('external requests denied');
  },
});
const phase = process.argv[2];
function report(message: object): void {
  if (!process.send) throw new Error('crash-child needs an IPC channel');
  process.send(message);
}
await queue.start();
await queue.work({
  ...handlers,
  async processInbox(id, context) {
    if (id !== process.env.M5_TEST_INBOX_ID) return 'deferred';
    if (phase === 'before-transaction') {
      report({ phase, id });
      await new Promise(() => {});
    }
    const outcome = await handlers.processInbox(id, context);
    if (phase === 'after-quarantine') {
      report({ phase, id });
      await new Promise(() => {});
    }
    report({ phase: 'settled', id, outcome });
    return outcome;
  },
});
report({ phase: 'ready' });
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    void queue.stop().finally(() => core.close());
  });
