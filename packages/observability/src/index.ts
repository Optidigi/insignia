import type { Writable } from 'node:stream';
import pino from 'pino';
import { Counter, Gauge, Registry } from 'prom-client';

const EVENTS = new Set([
  'admin_authentication',
  'worker_started',
  'worker_stopped',
  'worker_start_failed',
  'webhook_enqueued',
  'webhook_process_ok',
  'webhook_process_failed',
  'refresh_process_ok',
  'refresh_process_failed',
  'queue_job_rejected',
]);

export type RuntimeEvent =
  | 'admin_authentication'
  | 'worker_started'
  | 'worker_stopped'
  | 'worker_start_failed'
  | 'webhook_enqueued'
  | 'webhook_process_ok'
  | 'webhook_process_failed'
  | 'refresh_process_ok'
  | 'refresh_process_failed'
  | 'queue_job_rejected';

const ADMIN_AUTH_STAGES = [
  'ONLINE_EXCHANGE_REFRESH_REQUIRED',
  'ONLINE_EXCHANGE_FAILED',
  'ONLINE_GRANT_MISMATCH',
  'INSTALLATION_PROVIDER_READ_FAILED',
  'INSTALLATION_PROVIDER_SHAPE_OR_IDENTITY_MISMATCH',
  'TENANT_READ_FAILED',
  'CURRENT_INSTALLATION_READ_FAILED',
  'TENANT_NOT_FOUND_OR_SHOP_ID_MISMATCH',
  'CURRENT_INSTALLATION_MISSING_OR_INACTIVE',
  'CURRENT_INSTALLATION_ID_MISMATCH',
  'INSTALLATION_BOOTSTRAP_IDENTITY_MISMATCH',
  'INSTALLATION_BOOTSTRAP_STALE_STATE',
  'INSTALLATION_BOOTSTRAP_CONFIRMATION_REQUIRED',
  'INSTALLATION_BOOTSTRAP_WRITE_FAILED',
  'INSTALLATION_BOOTSTRAP_CREATED_SUCCEEDED',
  'INSTALLATION_BOOTSTRAP_REUSED_SUCCEEDED',
  'INSTALLATION_BOOTSTRAP_REINSTALLED_SUCCEEDED',
  'ONLINE_EXCHANGE_SUCCEEDED',
  'INSTALLATION_PROVIDER_READ_SUCCEEDED',
  'TENANT_RECONCILIATION_SUCCEEDED',
  'AUTHENTICATION_SUCCEEDED',
] as const;
export type AdminAuthenticationStage = (typeof ADMIN_AUTH_STAGES)[number];

export interface RuntimeLogDetails {
  authStage?: AdminAuthenticationStage;
  correlationId?: string;
  inboxId?: string;
  shopId?: string;
  jobId?: string;
  topic?: string;
  queue?: string;
  attempt?: number;
  errorClass?: string;
  count?: number;
}

/** Whitelist the complete event envelope; no merchant payload or error object enters Pino. */
function safeDetails(input: RuntimeLogDetails): RuntimeLogDetails {
  const result: RuntimeLogDetails = {};
  for (const key of ['inboxId', 'shopId', 'jobId'] as const) {
    const value = input[key];
    if (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
      result[key] = value;
  }
  if (input.topic === 'app/uninstalled') result.topic = input.topic;
  if (input.queue === 'insignia.shopify-webhook.v1' || input.queue === 'insignia.token-refresh.v1')
    result.queue = input.queue;
  if (
    input.errorClass === 'QueueStartupError' ||
    input.errorClass === 'ProcessingError' ||
    input.errorClass === 'RefreshError' ||
    input.errorClass === 'TransientPayloadExpired' ||
    input.errorClass === 'WebhookQueueExhausted' ||
    input.errorClass === 'TransientPayloadExpiredUnresolved' ||
    input.errorClass === 'PrivacyRetentionBlocked' ||
    input.errorClass === 'UnknownPayloadRetentionBlocked' ||
    input.errorClass === 'UninstallRecoveryUnresolved'
  )
    result.errorClass = input.errorClass;
  if (Number.isInteger(input.count) && (input.count ?? -1) >= 0 && (input.count ?? 101) <= 100)
    result.count = input.count;
  if (Number.isInteger(input.attempt) && (input.attempt ?? -1) >= 0 && (input.attempt ?? 0) <= 1000)
    result.attempt = input.attempt;
  return result;
}

function eventDetails(event: RuntimeEvent, input: RuntimeLogDetails) {
  if (event !== 'admin_authentication') return safeDetails(input);
  if (
    !ADMIN_AUTH_STAGES.includes(input.authStage!) ||
    typeof input.correlationId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.correlationId)
  )
    throw new Error('Invalid authentication diagnostic');
  return {
    authStage: input.authStage,
    correlationId: input.correlationId,
    statusClass:
      input.authStage === 'ONLINE_EXCHANGE_REFRESH_REQUIRED'
        ? 'refresh'
        : input.authStage!.endsWith('_SUCCEEDED')
          ? 'success'
          : 'failure',
  };
}

export type WebhookOutcome = 'received' | 'duplicate' | 'rejected' | 'enqueue_failure';
export type InboxOutcome = 'success' | 'failure' | 'deferred';
export type QueueOutcome = 'retry' | 'failure';
export type RefreshOutcome = 'success' | 'transient' | 'reauth_required';
export type ResolutionOutcome = 'resolved' | 'unresolved' | 'failed';

function checkedOutcome<T extends string>(allowed: readonly T[], value: T): T {
  if (!allowed.includes(value)) throw new Error('Invalid bounded metric outcome');
  return value;
}

export function createObservability(options: { stream?: Writable; level?: 'debug' | 'info' | 'warn' | 'error' } = {}) {
  const registry = new Registry();
  const rawLogger = pino(
    {
      level: options.level ?? 'info',
      base: undefined,
      redact: {
        paths: [
          'authorization',
          'headers.authorization',
          'clientSecret',
          'hmac',
          'accessToken',
          'refreshToken',
          'wrappingKey',
          'rawBody',
          'payload',
        ],
        censor: '[REDACTED]',
      },
    },
    options.stream,
  );

  const logger = {
    info(event: RuntimeEvent, details: RuntimeLogDetails = {}) {
      if (!EVENTS.has(event)) throw new Error('Invalid runtime event');
      rawLogger.info({ event, ...eventDetails(event, details) });
    },
    error(event: RuntimeEvent, details: RuntimeLogDetails = {}) {
      if (!EVENTS.has(event)) throw new Error('Invalid runtime event');
      rawLogger.error({ event, ...eventDetails(event, details) });
    },
  };

  const webhook = new Counter({
    name: 'insignia_webhook_total',
    help: 'Webhook ingress outcomes',
    labelNames: ['outcome'],
    registers: [registry],
  });
  const inbox = new Counter({
    name: 'insignia_inbox_processing_total',
    help: 'Durable inbox processing outcomes',
    labelNames: ['outcome'],
    registers: [registry],
  });
  const queue = new Counter({
    name: 'insignia_queue_attempt_total',
    help: 'Queue retry or terminal failure',
    labelNames: ['outcome'],
    registers: [registry],
  });
  const refresh = new Counter({
    name: 'insignia_credential_refresh_total',
    help: 'Credential refresh outcomes',
    labelNames: ['outcome'],
    registers: [registry],
  });
  const refreshContention = new Counter({
    name: 'insignia_refresh_claim_contention_total',
    help: 'Serialized refresh claim contention',
    registers: [registry],
  });
  const resolution = new Counter({
    name: 'insignia_inbox_ingress_resolution_total',
    help: 'Inbox resolution observed after accepted ingress',
    labelNames: ['outcome'],
    registers: [registry],
  });
  const backlog = new Gauge({
    name: 'insignia_unresolved_inbox_backlog',
    help: 'Number of unresolved inbox rows',
    registers: [registry],
  });

  const metrics = {
    webhook(outcome: WebhookOutcome) {
      webhook.labels(checkedOutcome(['received', 'duplicate', 'rejected', 'enqueue_failure'], outcome)).inc();
    },
    inbox(outcome: InboxOutcome) {
      inbox.labels(checkedOutcome(['success', 'failure', 'deferred'], outcome)).inc();
    },
    queue(outcome: QueueOutcome) {
      queue.labels(checkedOutcome(['retry', 'failure'], outcome)).inc();
    },
    refresh(outcome: RefreshOutcome) {
      refresh.labels(checkedOutcome(['success', 'transient', 'reauth_required'], outcome)).inc();
    },
    refreshContention() {
      refreshContention.inc();
    },
    resolution(outcome: ResolutionOutcome) {
      resolution.labels(checkedOutcome(['resolved', 'unresolved', 'failed'], outcome)).inc();
    },
    unresolvedBacklog(count: number) {
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid unresolved backlog');
      backlog.set(count);
    },
  };
  return { logger, metrics, registry };
}

export type Observability = ReturnType<typeof createObservability>;
