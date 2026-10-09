import { randomUUID } from 'node:crypto';
import type { DurableCore, WebhookQueueHandoffOutcome, WebhookQueueHandoffState } from '@insignia/database';
import { createObservability, type Observability } from '@insignia/observability';
import { type JobWithMetadata, PgBoss } from 'pg-boss';

import { assertQueueContract, QUEUE_SCHEMA_VERSION, REFRESH_QUEUE, WEBHOOK_QUEUE } from './queue-contract.js';

export { REFRESH_QUEUE, WEBHOOK_QUEUE } from './queue-contract.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Boss = Pick<
  PgBoss,
  'start' | 'stop' | 'getQueue' | 'send' | 'findJobs' | 'deleteJob' | 'work' | 'offWork' | 'schemaVersion'
>;

export interface JobContext {
  jobId: string;
  attempt: number;
  signal: AbortSignal;
}

export interface WorkerHandlers {
  /** Must commit business mutation and inbox processed marker in one durable transaction. */
  processInbox(inboxId: string, context: JobContext): Promise<undefined | 'deferred' | 'expired' | 'exhausted'>;
  /** Must durably mark terminal reauthorization before returning reauth_required. */
  refreshCredential(
    shopId: string,
    installationGeneration: number,
    context: JobContext,
  ): Promise<'success' | 'reauth_required' | 'contention' | undefined>;
}

export interface PgBossRuntimeOptions {
  connectionString?: string;
  schema?: string;
  /** Test seam. Production constructs its own pg-boss instance. */
  boss?: Boss;
  webhookHandoff: Pick<DurableCore['webhooks'], 'withQueueHandoff'>;
  observability?: Observability;
  /** Validated by the server composition from the credential wrapping-key ring. */
  credentialKeysReady?: boolean;
}

export interface PgBossRuntime {
  start(): Promise<void>;
  ensureWebhookEnqueued(inboxId: string): Promise<{ inboxId: string; status: 'enqueued' | 'already_enqueued' }>;
  removeExpiredWebhookJob(inboxId: string): Promise<boolean>;
  enqueueRefresh(shopId: string, installationGeneration: number): Promise<string>;
  work(handlers: WorkerHandlers): Promise<void>;
  stop(): Promise<void>;
  schemaVersion(): ReturnType<Boss['schemaVersion']>;
  checkDurableReady(): Promise<boolean>;
  readonly durableReady: boolean;
  readonly observability: Observability;
}

function assertUuid(value: string, label: string): void {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error(`Invalid ${label}`);
}

function assertJobPayload(data: unknown, allowed: readonly string[]): asserts data is Record<string, unknown> {
  if (
    data === null ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    Object.keys(data).length !== allowed.length ||
    Object.keys(data).some((key) => !allowed.includes(key))
  )
    throw new Error('Invalid queue job identity');
}

/** pg-boss owns its schema. Application dbmate migrations must never edit it. */
export function createPgBossRuntime(options: PgBossRuntimeOptions): PgBossRuntime {
  if (!options.boss && !options.connectionString) throw new Error('Missing worker database connection');
  const schema = options.schema ?? 'pgboss';
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid queue schema');
  const boss =
    options.boss ??
    new PgBoss({
      connectionString: options.connectionString,
      schema,
      migrate: false,
      createSchema: false,
      schedule: false,
      supervise: options.credentialKeysReady === true,
      persistQueueStats: false,
      monitorVacuum: false,
      reindex: false,
    });
  const observability = options.observability ?? createObservability();
  let started = false;
  let workersStarted = false;
  let stopped = false;
  let faulted = false;
  if (!options.boss)
    (boss as PgBoss).on('error', () => {
      faulted = true;
      observability.logger.error('worker_start_failed', { errorClass: 'QueueRuntimeError' });
    });
  const workerIds: { name: string; id: string }[] = [];

  function requireStarted() {
    if (!started || stopped) throw new Error('Queue runtime is not active');
  }

  async function checkContract() {
    if ((await boss.schemaVersion()) !== QUEUE_SCHEMA_VERSION) throw new Error('pg-boss schema version differs');
    for (const name of [WEBHOOK_QUEUE, REFRESH_QUEUE]) assertQueueContract(name, await boss.getQueue(name));
    if (!options.boss) {
      // Read-only privilege/clock probes also detect revoked grants after startup.
      const worker = options.credentialKeysReady === true;
      const { rows } = await (boss as PgBoss).getDb().executeSql(`SELECT ${schema}.job_now(),
        has_table_privilege(current_user, '${schema}.job', 'INSERT') AND has_table_privilege(current_user, '${schema}.job', 'UPDATE') AND
        has_table_privilege(current_user, '${schema}.job_common', 'INSERT') AND has_table_privilege(current_user, '${schema}.job_common', 'UPDATE') AND
        (${
          worker
            ? `has_table_privilege(current_user, '${schema}.job', 'DELETE') AND
          has_table_privilege(current_user, '${schema}.job_common', 'DELETE') AND
          has_column_privilege(current_user, '${schema}.version', 'flow_on', 'UPDATE') AND
          has_column_privilege(current_user, '${schema}.queue', 'monitor_on', 'UPDATE')`
            : 'true'
        }) AS allowed`);
      if (rows.length !== 1 || rows[0]?.allowed !== true) throw new Error('Queue runtime privileges are incomplete');
    }
  }

  async function start() {
    if (started) return;
    if (stopped) throw new Error('Queue runtime was stopped');
    if (options.credentialKeysReady === false) throw new Error('Credential wrapping keys not configured');
    try {
      await boss.start();
      await checkContract();
      started = true;
      observability.logger.info('worker_started');
    } catch (error) {
      await boss.stop({ graceful: true, timeout: 30_000 }).catch(() => {});
      observability.logger.error('worker_start_failed', { errorClass: 'QueueStartupError' });
      throw error;
    }
  }

  async function ensureWebhookEnqueued(inboxId: string): Promise<{
    inboxId: string;
    status: 'enqueued' | 'already_enqueued';
  }> {
    requireStarted();
    assertUuid(inboxId, 'inbox ID');
    async function confirm(state: WebhookQueueHandoffState): Promise<WebhookQueueHandoffOutcome> {
      let existing = await boss.findJobs<{ inboxId: string }>(WEBHOOK_QUEUE, { id: inboxId });
      if (existing.length === 0 && state === 'unconfirmed') {
        const sent = await boss.send(WEBHOOK_QUEUE, { inboxId }, { id: inboxId });
        if (sent === inboxId) return 'enqueued';
        if (sent !== null) throw new Error('Queue returned mismatched inbox job ID');
        // A null ACK is not absence: resolve the pinned exact singleton.
        existing = await boss.findJobs<{ inboxId: string }>(WEBHOOK_QUEUE, { id: inboxId });
      }
      if (existing.length === 0) return 'missing';
      if (existing.length !== 1 || existing[0]?.id !== inboxId) throw new Error('Queue handoff not confirmed');
      const job = existing[0];
      assertJobPayload(job.data, ['inboxId']);
      if (job.name !== WEBHOOK_QUEUE || job.data.inboxId !== inboxId) throw new Error('Queue job identity mismatch');
      if (job.state === 'failed' || job.state === 'cancelled') return 'exhausted';
      if (!['created', 'retry', 'active', 'completed'].includes(job.state))
        throw new Error('Queue job is not eligible for acknowledged handoff');
      // pg-boss owns automatic retryCount/retryLimit. Never reset failed jobs.
      return 'already_enqueued';
    }
    if (!options.webhookHandoff) throw new Error('Durable webhook queue handoff is unavailable');
    const status = await options.webhookHandoff.withQueueHandoff(inboxId, confirm);
    if (status !== 'enqueued' && status !== 'already_enqueued') {
      observability.metrics.queue('failure');
      throw new Error(`Webhook queue handoff ${status}; work remains unresolved`);
    }
    if (status === 'enqueued') observability.logger.info('webhook_enqueued', { inboxId });
    return { inboxId, status };
  }

  async function removeExpiredWebhookJob(inboxId: string): Promise<boolean> {
    requireStarted();
    if (options.credentialKeysReady !== true) throw new Error('Webhook cleanup requires worker privileges');
    assertUuid(inboxId, 'inbox ID');
    const existing = await boss.findJobs<{ inboxId: string }>(WEBHOOK_QUEUE, { id: inboxId });
    if (existing.length > 1) throw new Error('Queue cleanup identity is ambiguous');
    if (existing.length) {
      const job = existing[0]!;
      assertJobPayload(job.data, ['inboxId']);
      if (job.id !== inboxId || job.name !== WEBHOOK_QUEUE || job.data.inboxId !== inboxId)
        throw new Error('Queue cleanup identity mismatch');
      // Pinned CommandResponse is not a deletion proof; verify exact absence.
      await boss.deleteJob(WEBHOOK_QUEUE, inboxId);
    }
    return (await boss.findJobs(WEBHOOK_QUEUE, { id: inboxId })).length === 0;
  }

  async function enqueueRefresh(shopId: string, installationGeneration: number): Promise<string> {
    requireStarted();
    assertUuid(shopId, 'shop ID');
    if (!Number.isSafeInteger(installationGeneration) || installationGeneration < 1)
      throw new Error('Invalid installation generation');
    const jobId = randomUUID();
    const sent = await boss.send(REFRESH_QUEUE, { shopId, installationGeneration }, { id: jobId });
    if (sent !== jobId) throw new Error('Credential refresh queue handoff not confirmed');
    return jobId;
  }

  async function work(handlers: WorkerHandlers): Promise<void> {
    requireStarted();
    if (options.credentialKeysReady !== true) throw new Error('Credential wrapping keys not configured');
    if (workersStarted) throw new Error('Workers already registered');
    const webhookWorkerId = await boss.work(
      WEBHOOK_QUEUE,
      { batchSize: 1, includeMetadata: true },
      async (jobs: JobWithMetadata<{ inboxId: string }>[]) => {
        const job = jobs[0];
        if (!job || jobs.length !== 1) throw new Error('Unexpected webhook job batch');
        try {
          assertUuid(job.id, 'webhook job ID');
          assertJobPayload(job.data, ['inboxId']);
          if (job.data.inboxId !== job.id) throw new Error('Queue job identity mismatch');
          if (job.signal.aborted) throw new Error('Queue job attempt expired');
          const outcome = await handlers.processInbox(job.id, {
            jobId: job.id,
            attempt: job.retryCount,
            signal: job.signal,
          });
          observability.metrics.inbox(
            outcome === 'expired' || outcome === 'exhausted'
              ? 'failure'
              : outcome === 'deferred'
                ? 'deferred'
                : 'success',
          );
          if (outcome === 'expired')
            observability.logger.error('webhook_process_failed', { errorClass: 'TransientPayloadExpired' });
          else if (outcome === 'exhausted')
            observability.logger.error('webhook_process_failed', { errorClass: 'WebhookQueueExhausted' });
          else observability.logger.info('webhook_process_ok', { inboxId: job.id, attempt: job.retryCount });
        } catch {
          observability.metrics.inbox('failure');
          observability.metrics.queue(job.retryCount >= job.retryLimit ? 'failure' : 'retry');
          observability.logger.error('webhook_process_failed', {
            inboxId: job.id,
            attempt: job.retryCount,
            errorClass: 'ProcessingError',
          });
          // pg-boss persists serialized thrown errors in job.output on retries
          // and terminal failures. Keep that copy free of arbitrary payloads.
          throw new Error('Webhook processing failed');
        }
      },
    );
    workerIds.push({ name: WEBHOOK_QUEUE, id: webhookWorkerId });
    try {
      const refreshWorkerId = await boss.work(
        REFRESH_QUEUE,
        { batchSize: 1, includeMetadata: true },
        async (jobs: JobWithMetadata<{ shopId: string; installationGeneration: number }>[]) => {
          const job = jobs[0];
          if (!job || jobs.length !== 1) throw new Error('Unexpected refresh job batch');
          try {
            assertJobPayload(job.data, ['shopId', 'installationGeneration']);
            assertUuid(job.data.shopId as string, 'shop ID');
            const generation = job.data.installationGeneration;
            if (!Number.isSafeInteger(generation) || (generation as number) < 1)
              throw new Error('Invalid installation generation');
            if (job.signal.aborted) throw new Error('Queue job attempt expired');
            const outcome = await handlers.refreshCredential(job.data.shopId as string, generation as number, {
              jobId: job.id,
              attempt: job.retryCount,
              signal: job.signal,
            });
            if (outcome === 'contention') {
              observability.metrics.refreshContention();
              throw new Error('Refresh claim contention; retry required');
            }
            observability.metrics.refresh(outcome === 'reauth_required' ? 'reauth_required' : 'success');
            observability.logger.info('refresh_process_ok', {
              shopId: job.data.shopId as string,
              attempt: job.retryCount,
            });
          } catch (error) {
            observability.metrics.refresh('transient');
            observability.metrics.queue(job.retryCount >= job.retryLimit ? 'failure' : 'retry');
            observability.logger.error('refresh_process_failed', {
              attempt: job.retryCount,
              errorClass: 'RefreshError',
            });
            throw error;
          }
        },
      );
      workerIds.push({ name: REFRESH_QUEUE, id: refreshWorkerId });
      workersStarted = true;
    } catch (error) {
      await boss.offWork(WEBHOOK_QUEUE, { id: webhookWorkerId, wait: true });
      workerIds.length = 0;
      throw error;
    }
  }

  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    try {
      for (const worker of workerIds) await boss.offWork(worker.name, { id: worker.id, wait: true });
    } finally {
      if (started) await boss.stop({ graceful: true, timeout: 30_000 });
      started = false;
      workersStarted = false;
      observability.logger.info('worker_stopped');
    }
  }

  return {
    start,
    ensureWebhookEnqueued,
    removeExpiredWebhookJob,
    enqueueRefresh,
    work,
    stop,
    schemaVersion: () => {
      requireStarted();
      return boss.schemaVersion();
    },
    async checkDurableReady() {
      if (!started || !workersStarted || stopped || faulted || options.credentialKeysReady !== true) return false;
      try {
        await checkContract();
        return true;
      } catch {
        return false;
      }
    },
    get durableReady() {
      return started && workersStarted && !stopped && !faulted && options.credentialKeysReady === true;
    },
    observability,
  };
}
