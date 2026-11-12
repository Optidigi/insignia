import type { Writable } from 'node:stream';
import pino from 'pino';
import { Counter, Gauge, Registry } from 'prom-client';

const EVENTS = new Set([
  'admin_authentication',
  'artwork_request_timing',
  'buyer_request_failed',
  'buyer_request_rejected',
  'buyer_request_timing',
  'customer_artwork_notification',
  'worker_started',
  'worker_stopped',
  'worker_start_failed',
  'webhook_enqueued',
  'webhook_process_ok',
  'webhook_process_failed',
  'refresh_process_ok',
  'refresh_process_failed',
  'signing_key_destruction',
  'public_config_drift',
  'queue_job_rejected',
  'lifecycle_credential_unavailable',
]);

export type RuntimeEvent =
  | 'admin_authentication'
  | 'artwork_request_timing'
  | 'buyer_request_failed'
  /** An expected 4xx outcome: buyer-actionable (info) or BUSY, transient and retryable (warn). */
  | 'buyer_request_rejected'
  | 'buyer_request_timing'
  | 'customer_artwork_notification'
  | 'worker_started'
  | 'worker_stopped'
  | 'worker_start_failed'
  | 'webhook_enqueued'
  | 'webhook_process_ok'
  | 'webhook_process_failed'
  | 'refresh_process_ok'
  | 'refresh_process_failed'
  | 'signing_key_destruction'
  | 'public_config_drift'
  | 'queue_job_rejected'
  /** Warn: an active installation has no usable offline credential; it needs reauthorization, not a retry. */
  | 'lifecycle_credential_unavailable';

const ADMIN_AUTH_STAGES = [
  'BEARER_MISSING',
  'BEARER_MALFORMED',
  'SESSION_TOKEN_SIGNATURE_REJECTED',
  'SESSION_TOKEN_AUDIENCE_REJECTED',
  'SESSION_TOKEN_TIME_REJECTED',
  'SESSION_TOKEN_FORMAT_REJECTED',
  'SESSION_TOKEN_REJECTED',
  'SESSION_IDENTITY_REJECTED',
  'AUTHENTICATED_ACTOR_REJECTED',
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
  'OFFLINE_BOOTSTRAP_INSTALLED_SUCCEEDED',
  'OFFLINE_BOOTSTRAP_EXISTING_SUCCEEDED',
  'OFFLINE_BOOTSTRAP_BUSY',
  'OFFLINE_BOOTSTRAP_UNRESOLVED',
  'OFFLINE_BOOTSTRAP_INACTIVE',
  'OFFLINE_BOOTSTRAP_REJECTED',
] as const;
export type AdminAuthenticationStage = (typeof ADMIN_AUTH_STAGES)[number];

const BUYER_STAGES = [
  'config',
  'sessions',
  'quote-proposals',
  'quotes',
  'designs',
  'cart-applications',
  'cart-state',
  'request',
] as const;
const BUYER_FAILURES = [
  'ReviewRequired',
  'UnsupportedMarket',
  'ArtworkExpired',
  'PositionInvalid',
  'ProductUnavailable',
  'CountryRequired',
  'EntitlementDenied',
  'ShopDayChanged',
  'DatabaseLockTimeout',
  'DatabaseQueryTimeout',
  'DatabasePermissionDenied',
  'ProviderReadUnavailable',
  'ReleaseEvidenceUnavailable',
  'EntitlementObservationUnavailable',
  'SignerUnavailable',
  'PublicConfigDrift',
  'TypeError',
  'UnexpectedFailure',
] as const;
export const BUYER_PROPOSAL_FAILURE_STAGES = [
  'request-setup',
  'prepare',
  'native-configuration',
  'primary-context',
  'positions',
  'availability',
  'release-prepare',
  'readiness-observe',
  'release-observe',
  'presentation',
  'current-readiness',
  'tenant',
  'shop',
  'entitlement',
  'revision',
  'artwork',
  'variant',
  'private-retention',
  'persistence',
  'owned-history',
  'response-projection',
  'response-validation',
  'ambiguous',
] as const;
export type BuyerFailureDiagnostic = {
  proposalStage?: (typeof BUYER_PROPOSAL_FAILURE_STAGES)[number];
  correlationId: string;
  buyerStage: (typeof BUYER_STAGES)[number];
  errorClass: (typeof BUYER_FAILURES)[number];
};

// One summary per proposal/acceptance; at most 64 spans, each with finite vocabulary.
// Integer milliseconds cap the timing payload below 12 KiB. Spans overlap: never sum.
export type BuyerTimingSpan = {
  id: number;
  parentId: number | null;
  stage: NonNullable<BuyerFailureDiagnostic['proposalStage']>;
  offsetMs: number;
  durationMs: number;
  outcome: 'success' | 'failure' | 'unfinished';
};
export type BuyerTimingDiagnostic = {
  correlationId: string;
  operation: 'proposal' | 'acceptance' | 'config';
  /** Transport cancellation at snapshot time does not prove a write did not commit. */
  outcome: 'success' | 'failure' | 'cancelled';
  totalMs: number;
  truncated: boolean;
  spans: BuyerTimingSpan[];
};

const ARTWORK_OPERATIONS = ['begin', 'complete', 'status'] as const;
const ARTWORK_STATES = [
  'UPLOADING',
  'QUEUED',
  'INSPECTING',
  'PROMOTING',
  'USABLE',
  'REJECTED',
  'DELETING',
  'DELETED',
] as const;
export const ARTWORK_REQUEST_FAILURES = [
  'METHOD_NOT_ALLOWED',
  'AUTHENTICATION_REQUIRED',
  'AUTHENTICATION_UNAVAILABLE',
  'INVALID_DECLARATION',
  'INSPECTION_UNAVAILABLE',
  'INVALID_INPUT',
  'NOT_FOUND',
  'EXPIRED',
  'NOT_USABLE',
  'CONFLICT',
  'RATE_LIMITED',
  'UNAVAILABLE',
] as const;
/** One line per guest artwork begin/complete/status request, so a stalled check can be matched to its requests. */
export type ArtworkTimingDiagnostic = {
  correlationId: string;
  operation: (typeof ARTWORK_OPERATIONS)[number];
  outcome: 'success' | 'failure';
  httpStatus: number;
  totalMs: number;
  /** Opaque server-generated asset id; absent for begin failures. */
  assetId?: string;
  /** Asset state returned to the buyer (status/complete). */
  state?: (typeof ARTWORK_STATES)[number];
  failure?: (typeof ARTWORK_REQUEST_FAILURES)[number];
};

/** Every errorClass a non-buyer event may carry. RuntimeLogDetails types errorClass against this list,
 * so an emitter cannot introduce a class that the log envelope would silently drop. */
const RUNTIME_ERROR_CLASSES = [
  'CUSTOMER_EMAIL_RUNTIME_UNAVAILABLE',
  'QueueStartupError',
  'ProcessingError',
  'RefreshError',
  'TransientPayloadExpired',
  'WebhookQueueExhausted',
  'TransientPayloadExpiredUnresolved',
  'PrivacyRetentionBlocked',
  'UninstallPayloadRetentionBlocked',
  'UnknownPayloadRetentionBlocked',
  'UnsupportedPayloadRetentionBlocked',
  'UninstallRecoveryUnresolved',
  'WEBHOOK_RETENTION_UNAVAILABLE',
  'UNINSTALL_RECOVERY_UNAVAILABLE',
  'PURCHASE_RECOVERY_UNAVAILABLE',
  'PURCHASE_DISCOVERY_UNAVAILABLE',
  'PURCHASE_RECONCILIATION_UNAVAILABLE',
  'PURCHASE_PAYLOAD_CLEANUP_UNAVAILABLE',
  'ARTWORK_CLEANUP_UNAVAILABLE',
  'MERCHANT_PREVIEW_CLEANUP_UNAVAILABLE',
  'BUYER_PAYLOAD_CLEANUP_UNAVAILABLE',
  'SIGNING_KEY_DESTRUCTION_UNAVAILABLE',
  'PUBLIC_CONFIG_DRIFT',
  'QueueRuntimeError',
  'UNINSTALL_PRIVACY_RECOVERY_UNAVAILABLE',
  'CUSTOMER_PRIVACY_CLEANUP_UNAVAILABLE',
  'ShopPrivacyAuthorityRequired',
  'USAGE_QUALIFICATION_UNAVAILABLE',
  'UNINSTALL_ENROLLMENT_UNAVAILABLE',
  'ARTWORK_RUNNER_UNAVAILABLE',
  'ARTWORK_RUNNER_ABORTED',
  'ARTWORK_RUNNER_DEADLINE',
  'LIFECYCLE_CREDENTIAL_MISSING',
  'LIFECYCLE_CREDENTIAL_REAUTH_REQUIRED',
  'LIFECYCLE_INSTALLATION_INACTIVE',
] as const;
export type RuntimeErrorClass = (typeof RUNTIME_ERROR_CLASSES)[number];

export interface RuntimeLogDetails {
  timing?: BuyerTimingDiagnostic;
  artworkTiming?: ArtworkTimingDiagnostic;
  buyerStage?: BuyerFailureDiagnostic['buyerStage'];
  proposalStage?: BuyerFailureDiagnostic['proposalStage'];
  authStage?: AdminAuthenticationStage;
  correlationId?: string;
  inboxId?: string;
  shopId?: string;
  jobId?: string;
  topic?: string;
  queue?: string;
  attempt?: number;
  errorClass?: RuntimeErrorClass | BuyerFailureDiagnostic['errorClass'];
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
  if (RUNTIME_ERROR_CLASSES.includes(input.errorClass as RuntimeErrorClass)) result.errorClass = input.errorClass;
  if (Number.isSafeInteger(input.count) && (input.count ?? -1) >= 0) result.count = input.count;
  if (Number.isInteger(input.attempt) && (input.attempt ?? -1) >= 0 && (input.attempt ?? 0) <= 1000)
    result.attempt = input.attempt;
  return result;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function artworkTimingDetails(t: ArtworkTimingDiagnostic | undefined) {
  if (
    !t ||
    !UUID.test(t.correlationId) ||
    !ARTWORK_OPERATIONS.includes(t.operation) ||
    !['success', 'failure'].includes(t.outcome) ||
    !Number.isInteger(t.httpStatus) ||
    t.httpStatus < 100 ||
    t.httpStatus > 599 ||
    !Number.isInteger(t.totalMs) ||
    t.totalMs < 0 ||
    t.totalMs > 86400000 ||
    (t.assetId !== undefined && !UUID.test(t.assetId)) ||
    (t.state !== undefined && !ARTWORK_STATES.includes(t.state)) ||
    (t.failure !== undefined && !ARTWORK_REQUEST_FAILURES.includes(t.failure))
  )
    throw new Error('Invalid artwork timing diagnostic');
  return {
    correlationId: t.correlationId,
    operation: t.operation,
    outcome: t.outcome,
    httpStatus: t.httpStatus,
    totalMs: t.totalMs,
    ...(t.assetId === undefined ? {} : { assetId: t.assetId }),
    ...(t.state === undefined ? {} : { state: t.state }),
    ...(t.failure === undefined ? {} : { failure: t.failure }),
  };
}

function eventDetails(event: RuntimeEvent, input: RuntimeLogDetails) {
  if (event === 'artwork_request_timing') return artworkTimingDetails(input.artworkTiming);
  if (event === 'buyer_request_timing') {
    const t = input.timing;
    const ms = (v: number) => Number.isInteger(v) && v >= 0 && v <= 86400000;
    if (
      !t ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t.correlationId) ||
      !['proposal', 'acceptance', 'config'].includes(t.operation) ||
      !['success', 'failure', 'cancelled'].includes(t.outcome) ||
      !ms(t.totalMs) ||
      typeof t.truncated !== 'boolean' ||
      !Array.isArray(t.spans) ||
      t.spans.length > 64
    )
      throw new Error('Invalid buyer timing diagnostic');
    const ids = new Set<number>();
    const spans = t.spans.map((s) => {
      if (
        !Number.isInteger(s.id) ||
        s.id < 1 ||
        s.id > 64 ||
        ids.has(s.id) ||
        (s.parentId !== null && !ids.has(s.parentId)) ||
        !BUYER_PROPOSAL_FAILURE_STAGES.includes(s.stage) ||
        !ms(s.offsetMs) ||
        !ms(s.durationMs) ||
        !['success', 'failure', 'unfinished'].includes(s.outcome)
      )
        throw new Error('Invalid buyer timing span');
      ids.add(s.id);
      return {
        id: s.id,
        parentId: s.parentId,
        stage: s.stage,
        offsetMs: s.offsetMs,
        durationMs: s.durationMs,
        outcome: s.outcome,
      };
    });
    return {
      correlationId: t.correlationId,
      operation: t.operation,
      outcome: t.outcome,
      totalMs: t.totalMs,
      truncated: t.truncated,
      spans,
    };
  }
  if (event === 'buyer_request_failed' || event === 'buyer_request_rejected') {
    if (
      !input.buyerStage ||
      !BUYER_STAGES.includes(input.buyerStage) ||
      !BUYER_FAILURES.includes(input.errorClass as BuyerFailureDiagnostic['errorClass']) ||
      typeof input.correlationId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.correlationId)
    )
      throw new Error('Invalid buyer failure diagnostic');
    if (input.proposalStage !== undefined && !BUYER_PROPOSAL_FAILURE_STAGES.includes(input.proposalStage))
      throw new Error('Invalid buyer proposal failure stage');
    return {
      buyerStage: input.buyerStage,
      correlationId: input.correlationId,
      errorClass: input.errorClass,
      ...(input.proposalStage === undefined ? {} : { proposalStage: input.proposalStage }),
    };
  }
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
export type UsageQualificationOutcome = 'success' | 'failure';
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
    warn(event: RuntimeEvent, details: RuntimeLogDetails = {}) {
      if (!EVENTS.has(event)) throw new Error('Invalid runtime event');
      rawLogger.warn({ event, ...eventDetails(event, details) });
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
  const usageQualification = new Counter({
    name: 'insignia_usage_qualification_pass_total',
    help: 'Completed usage qualification passes, not billed usage',
    labelNames: ['outcome'],
    registers: [registry],
  });
  const backlog = new Gauge({
    name: 'insignia_unresolved_inbox_backlog',
    help: 'Number of unresolved inbox rows',
    registers: [registry],
  });

  const metrics = {
    usageQualification(outcome: UsageQualificationOutcome) {
      usageQualification.labels(checkedOutcome(['success', 'failure'], outcome)).inc();
    },
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
