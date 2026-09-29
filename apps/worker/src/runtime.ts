import { randomUUID } from 'node:crypto';
import { createObservability, type Observability } from '@insignia/observability';
import { type JobWithMetadata, PgBoss } from 'pg-boss';

export const WEBHOOK_QUEUE = 'insignia.shopify-webhook.v1';
export const REFRESH_QUEUE = 'insignia.token-refresh.v1';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETRY_LIMIT = 5;
type Boss = Pick<PgBoss, 'start' | 'stop' | 'createQueue' | 'send' | 'findJobs' | 'work' | 'offWork' | 'schemaVersion'>;

export interface JobContext {
  jobId: string;
  attempt: number;
  signal: AbortSignal;
}

export interface WorkerHandlers {
  /** Must commit business mutation and inbox processed marker in one durable transaction. */
  processInbox(inboxId: string, context: JobContext): Promise<void>;
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
  observability?: Observability;
  /** Validated by the server composition from the credential wrapping-key ring. */
  credentialKeysReady?: boolean;
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
export function createPgBossRuntime(options: PgBossRuntimeOptions) {
  if (!options.boss && !options.connectionString) throw new Error('Missing worker database connection');
  const boss =
    options.boss ?? new PgBoss({ connectionString: options.connectionString, schema: options.schema ?? 'pgboss' });
  const observability = options.observability ?? createObservability();
  let started = false;
  let workersStarted = false;
  let stopped = false;
  const workerIds: { name: string; id: string }[] = [];

  function requireStarted() {
    if (!started || stopped) throw new Error('Queue runtime is not active');
  }

  async function start() {
    if (started) return;
    if (stopped) throw new Error('Queue runtime was stopped');
    if (options.credentialKeysReady === false) throw new Error('Credential wrapping keys not configured');
    try {
      await boss.start();
      await boss.createQueue(WEBHOOK_QUEUE, {
        retryLimit: RETRY_LIMIT,
        retryDelay: 2,
        retryBackoff: true,
        expireInSeconds: 120,
        retentionSeconds: 14 * 86400,
        deleteAfterSeconds: 7 * 86400,
      });
      await boss.createQueue(REFRESH_QUEUE, {
        retryLimit: RETRY_LIMIT,
        retryDelay: 2,
        retryBackoff: true,
        expireInSeconds: 120,
        retentionSeconds: 14 * 86400,
        deleteAfterSeconds: 7 * 86400,
      });
      const version = await boss.schemaVersion();
      if (!Number.isSafeInteger(version) || (version ?? 0) < 1) throw new Error('pg-boss schema is unavailable');
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
    const data = { inboxId };
    const sent = await boss.send(WEBHOOK_QUEUE, data, { id: inboxId });
    if (sent === inboxId) {
      observability.logger.info('webhook_enqueued', { inboxId });
      return { inboxId, status: 'enqueued' };
    }
    if (sent !== null) throw new Error('Queue returned mismatched inbox job ID');
    const existing = await boss.findJobs<{ inboxId: string }>(WEBHOOK_QUEUE, { id: inboxId });
    if (existing.length !== 1 || existing[0]?.id !== inboxId) throw new Error('Queue handoff not confirmed');
    const job = existing[0];
    assertJobPayload(job.data, ['inboxId']);
    if (job.name !== WEBHOOK_QUEUE || job.data.inboxId !== inboxId) throw new Error('Queue job identity mismatch');
    if (!['created', 'retry', 'active', 'completed'].includes(job.state))
      throw new Error('Queue job is not eligible for acknowledged handoff');
    observability.metrics.webhook('duplicate');
    return { inboxId, status: 'already_enqueued' };
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
          await handlers.processInbox(job.id, { jobId: job.id, attempt: job.retryCount, signal: job.signal });
          observability.metrics.inbox('success');
          observability.logger.info('webhook_process_ok', { inboxId: job.id, attempt: job.retryCount });
        } catch (error) {
          observability.metrics.inbox('failure');
          observability.metrics.queue(job.retryCount >= job.retryLimit ? 'failure' : 'retry');
          observability.logger.error('webhook_process_failed', {
            inboxId: job.id,
            attempt: job.retryCount,
            errorClass: 'ProcessingError',
          });
          throw error;
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
    enqueueRefresh,
    work,
    stop,
    schemaVersion: () => {
      requireStarted();
      return boss.schemaVersion();
    },
    async checkDurableReady() {
      if (!started || !workersStarted || stopped || options.credentialKeysReady !== true) return false;
      try {
        const version = await boss.schemaVersion();
        return Number.isSafeInteger(version) && (version ?? 0) > 0;
      } catch {
        return false;
      }
    },
    get durableReady() {
      return started && workersStarted && !stopped && options.credentialKeysReady === true;
    },
    observability,
  };
}

export type PgBossRuntime = ReturnType<typeof createPgBossRuntime>;
