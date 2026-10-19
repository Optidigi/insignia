/** Fresh process consumer of the real built worker; provider access is forbidden. */
import assert from 'node:assert/strict';
import { createDurableCore } from '@insignia/database';
import { Pool } from 'pg';
import { createDurableWorkerHandlers } from '../dist/handlers.js';

assert(process.env.DATABASE_URL && process.env.SYNTHETIC_RECEIPT_ID);
globalThis.fetch = async () => {
  throw new Error('network_escape_denied');
};
const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
try {
  const handlers = createDurableWorkerHandlers(core, {
    async refresh() {
      throw new Error('provider_request_denied');
    },
  });
  const outcome = await handlers.processInbox(process.env.SYNTHETIC_RECEIPT_ID, {
    jobId: 'expired-inbox-process',
    attempt: 0,
    signal: new AbortController().signal,
  });
  console.log(JSON.stringify({ outcome }));
} finally {
  await core.close();
}
