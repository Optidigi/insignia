import type { Writable } from 'node:stream';
import pino from 'pino';
import { Counter, Gauge, Registry } from 'prom-client';

const EVENTS = new Set([
  'admin_authentication',
  'admin_config_rejected',
  'admin_request_failed',
  'system_request_failed',
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
  'queue_job_rejection_cleared',
  'lifecycle_credential_unavailable',
  'web_listen_failed',
  'publication_abandonment',
  'publication_preparation_stopped',
  'publication_request_timing',
]);

export type RuntimeEvent =
  | 'admin_authentication'
  /** Info: a product configuration command was rejected (422) by one named validation rule. */
  | 'admin_config_rejected'
  /** Error: an admin API request failed unexpectedly (503); names the route, error class and own-code site only. */
  | 'admin_request_failed'
  /** Error: a Shopify webhook or operator request failed unexpectedly (503); names the route, error class and own-code site only. */
  | 'system_request_failed'
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
  /** Info: a held-row class that `queue_job_rejected` reported has no held rows left. */
  | 'queue_job_rejection_cleared'
  /** Warn: an active installation has no usable offline credential; it needs reauthorization, not a retry. */
  | 'lifecycle_credential_unavailable'
  /** Error: the web server could not bind its address; the process exits non-zero. */
  | 'web_listen_failed'
  /** #466 abandoned publication hold: restored/finalized at info; flagged/ambiguous/conflict at warn. */
  | 'publication_abandonment'
  /** Warn: a publish could not be prepared (Functions, release verification or signing); names the step only. */
  | 'publication_preparation_stopped'
  /** Info: one line per publish request, its total and its finite-stage timing spans. */
  | 'publication_request_timing';

export const PUBLICATION_ABANDONMENT_OUTCOMES = [
  'restored',
  'flagged',
  'not_dispatched',
  'ambiguous',
  'conflict',
  'skipped',
  'finalized',
] as const;
export type PublicationAbandonmentOutcome = (typeof PUBLICATION_ABANDONMENT_OUTCOMES)[number];
const PUBLICATION_ABANDONMENT_REASONS = [
  'fields_written',
  'release_wait_after_writes',
  'acquisition_unsettled',
  'hold_not_owned',
  'product_changed',
  'claim_fenced',
  'claim_unsettled',
  'restore_ambiguous',
  'restore_conflict',
  'not_quiet',
  'superseded',
  'not_candidate',
  'observation_unavailable',
  'observation_empty',
  'credential_unavailable',
  'claim_in_flight',
] as const;
export type PublicationAbandonmentReason = (typeof PUBLICATION_ABANDONMENT_REASONS)[number];

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
  /** Uninstall webhook enrollment, run with the online grant after the installation read, failed. */
  'UNINSTALL_ENROLLMENT_FAILED',
  'INSTALLATION_BOOTSTRAP_CREATED_SUCCEEDED',
  'INSTALLATION_BOOTSTRAP_REUSED_SUCCEEDED',
  'INSTALLATION_BOOTSTRAP_REINSTALLED_SUCCEEDED',
  'ONLINE_EXCHANGE_SUCCEEDED',
  'INSTALLATION_PROVIDER_READ_SUCCEEDED',
  'TENANT_RECONCILIATION_SUCCEEDED',
  'AUTHENTICATION_SUCCEEDED',
  /** A verified online grant for the same shop, staff and session was reused within its expiry. */
  'ONLINE_GRANT_REUSED_SUCCEEDED',
  /** A recent installation observation was reused after its durable generation fence matched. */
  'INSTALLATION_OBSERVATION_REUSED_SUCCEEDED',
  'OFFLINE_BOOTSTRAP_INSTALLED_SUCCEEDED',
  'OFFLINE_BOOTSTRAP_EXISTING_SUCCEEDED',
  'OFFLINE_BOOTSTRAP_BUSY',
  'OFFLINE_BOOTSTRAP_UNRESOLVED',
  'OFFLINE_BOOTSTRAP_INACTIVE',
  'OFFLINE_BOOTSTRAP_REJECTED',
] as const;
export type AdminAuthenticationStage = (typeof ADMIN_AUTH_STAGES)[number];
/** Bounded Shopify failure codes; never a provider message or body. */
const ADMIN_PROVIDER_CODES = [
  'THROTTLED',
  'MAX_COST_EXCEEDED',
  'ACCESS_DENIED',
  'INTERNAL_SERVER_ERROR',
  'GRAPHQL_ERROR',
  'HTTP_401',
  'HTTP_403',
  'HTTP_429',
  'HTTP_5XX',
  'HTTP_OTHER',
  'TIMEOUT',
  'NETWORK',
] as const;
export type AdminProviderDiagnosticCode = (typeof ADMIN_PROVIDER_CODES)[number];

const ADMIN_CONFIG_ACTIONS = ['create', 'save', 'publish', 'reconcile', 'command'] as const;
export type AdminConfigAction = (typeof ADMIN_CONFIG_ACTIONS)[number];
/** The web app owns the code vocabulary; the log admits only its bounded upper-snake-case shape. */
const REJECTION_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

export const ADMIN_FAILURE_ROUTES = [
  'catalog',
  'product-config',
  'product-config-command',
  'readiness',
  'billing',
  'setup-status',
  'methods',
  'method',
  'signing',
  'preferences',
  'merchant-media',
  'merchant-artwork',
  'artwork-link',
  'purchases',
] as const;
/** Non-user routes: Shopify webhook ingress, its per-request setup, and the operator metrics scrape. */
export const SYSTEM_FAILURE_ROUTES = ['shopify-webhook', 'shopify-webhook-setup', 'internal-metrics'] as const;
const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
/** A code identifier, never message text. */
const ERROR_CLASS = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
/** Upper-case codes such as ECONNRESET, ERR_INVALID_ARG_TYPE or a PostgreSQL SQLSTATE (42P01). */
const ERROR_CODE = /^[A-Z0-9][A-Z0-9_]{2,63}$/;
/** A relative path into Insignia's own code and a line number; no absolute prefix, query or text. */
const ERROR_SITE =
  /^(?:@insignia\/)?[A-Za-z0-9_.[\]-]+(?:\/[A-Za-z0-9_.[\]-]+){0,15}\.(?:[cm]?js|[cm]?ts):[1-9][0-9]{0,6}$/;
/** An unexpected admin failure, reduced before it crosses into the log; see describeUnexpectedError. */
export type AdminFailureDiagnostic = {
  adminRoute: (typeof ADMIN_FAILURE_ROUTES)[number];
  httpMethod: (typeof HTTP_METHODS)[number];
  errorClass: string;
  errorCode?: string;
  errorSite?: string;
  correlationId?: string;
};
export type UnexpectedErrorDiagnostic = Pick<AdminFailureDiagnostic, 'errorClass' | 'errorCode' | 'errorSite'>;
/** An unexpected webhook or operator failure: no method, correlation, shop, topic or payload. */
export type SystemFailureDiagnostic = UnexpectedErrorDiagnostic & {
  systemRoute: (typeof SYSTEM_FAILURE_ROUTES)[number];
};
function validUnexpectedError(f: UnexpectedErrorDiagnostic): boolean {
  return (
    typeof f.errorClass === 'string' &&
    ERROR_CLASS.test(f.errorClass) &&
    (f.errorCode === undefined || (typeof f.errorCode === 'string' && ERROR_CODE.test(f.errorCode))) &&
    (f.errorSite === undefined ||
      (typeof f.errorSite === 'string' && f.errorSite.length <= 200 && ERROR_SITE.test(f.errorSite)))
  );
}
function unexpectedErrorDetails(f: UnexpectedErrorDiagnostic): UnexpectedErrorDiagnostic {
  return {
    errorClass: f.errorClass,
    ...(f.errorCode === undefined ? {} : { errorCode: f.errorCode }),
    ...(f.errorSite === undefined ? {} : { errorSite: f.errorSite }),
  };
}

/** Reduce a stack frame location to a path relative to Insignia's own code, or null for a
 * third-party, runtime-internal or unrecognized frame. Only the path and line survive. */
function ownCodeSite(frame: string): string | null {
  const location = /\(?((?:file:\/\/)?\/[^\s()]*?)(?:\?[^\s():]*)?:(\d+):\d+\)?$/.exec(frame.trim());
  const [, located, line] = location ?? [];
  if (!located || !line) return null;
  const path = located.replace(/^file:\/\//, '');
  const modules = path.lastIndexOf('/node_modules/');
  let relative: string | null = null;
  if (modules >= 0) {
    const dependency = path.slice(modules + '/node_modules/'.length);
    if (dependency.startsWith('@insignia/')) relative = dependency;
  } else {
    const anchor = ['/apps/', '/packages/', '/dist/']
      .map((segment) => path.lastIndexOf(segment))
      .find((index) => index >= 0);
    if (anchor !== undefined) relative = path.slice(anchor + 1);
  }
  const site = relative ? `${relative}:${line}` : null;
  return site && site.length <= 200 && ERROR_SITE.test(site) ? site : null;
}

/** Name an unexpected error without its message: constructor name, a short code and the first
 * stack frame in Insignia's own code. Messages may carry shop, customer or provider text. */
export function describeUnexpectedError(error: unknown): UnexpectedErrorDiagnostic {
  if (typeof error !== 'object' || error === null) return { errorClass: 'Error' };
  const name: unknown = (error as { constructor?: { name?: unknown } }).constructor?.name;
  const code: unknown = (error as { code?: unknown }).code;
  const stack: unknown = (error as { stack?: unknown }).stack;
  const site =
    typeof stack === 'string'
      ? stack
          .split('\n')
          .slice(1, 51)
          .map(ownCodeSite)
          .find((value) => value !== null)
      : undefined;
  return {
    errorClass: typeof name === 'string' && ERROR_CLASS.test(name) ? name : 'Error',
    ...(typeof code === 'string' && ERROR_CODE.test(code) ? { errorCode: code } : {}),
    ...(site ? { errorSite: site } : {}),
  };
}

const BUYER_STAGES = [
  'config',
  'sessions',
  'quote-proposals',
  'quotes',
  'designs',
  'cart-applications',
  'cart-state',
  'request',
  /** Guest (App Proxy) artwork upload, status and preview. */
  'artwork',
  /** Guest (App Proxy) artwork session issue. */
  'artwork-session',
  /** The emailed customer artwork link (bearer capability). */
  'customer-artwork',
] as const;
const BUYER_FAILURES = [
  'ReviewRequired',
  'UnsupportedMarket',
  'ArtworkExpired',
  'PositionInvalid',
  'ProductUnavailable',
  'CountryRequired',
  'EntitlementDenied',
  'CapacityExceeded',
  'SessionQuotaExhausted',
  'ShopDayChanged',
  'DatabaseLockTimeout',
  'DatabaseQueryTimeout',
  'DatabasePermissionDenied',
  'ProviderReadUnavailable',
  'ReleaseEvidenceExpired',
  'ReleaseEvidenceMismatch',
  'ReleaseEvidenceMissing',
  'ReleaseSourceUnavailable',
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
  'release-read',
  'release-collect',
  'public-config',
  'function-ownership',
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
/** Which check refused an UNSUPPORTED_MARKET; one code per check (the application's MarketRefusalReason). */
export const MARKET_REFUSAL_REASONS = [
  'STOREFRONT_MARKET_UNAVAILABLE',
  'MARKET_NOT_PRIMARY',
  'COUNTRY_NOT_IN_PRIMARY_MARKET',
  'COUNTRY_UNRECOGNISED',
  'CURRENCY_UNSUPPORTED',
  'CURRENCY_MISMATCH',
  'EUR_COUNTRY_NOT_QUALIFIED',
  'EUR_PROFILE_UNAVAILABLE',
] as const;
export type BuyerFailureDiagnostic = {
  proposalStage?: (typeof BUYER_PROPOSAL_FAILURE_STAGES)[number];
  correlationId: string;
  buyerStage: (typeof BUYER_STAGES)[number];
  errorClass: (typeof BUYER_FAILURES)[number];
  /** UNSUPPORTED_MARKET only. Shop configuration, never the buyer's country, IP or cart. */
  refusalReason?: (typeof MARKET_REFUSAL_REASONS)[number];
  /** Numeric Market IDs (digits only), present only when the check knew them. */
  storefrontMarketId?: string;
  primaryMarketId?: string;
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

/** The steps of one publish request (`POST .../config` action publish), in rough order. */
export const PUBLICATION_TIMING_STAGES = [
  'authentication',
  'product-read',
  'shop-currency',
  'eligibility',
  'preview-capture',
  'preview-verify',
  'preparation',
  'functions-setup',
  'release-verification',
  'release-collect',
  'signing',
  'command',
  'publication-prepare',
  'publication-advance',
  'activation-advance',
  'release-check',
] as const;
export type PublicationTimingStage = (typeof PUBLICATION_TIMING_STAGES)[number];
export const PUBLICATION_TIMING_OUTCOMES = ['accepted', 'resend', 'conflict', 'invalid', 'refused', 'failure'] as const;
/** One summary per publish request; at most 64 spans. Spans nest and overlap: never sum them. */
export type PublicationTimingDiagnostic = {
  correlationId: string;
  outcome: (typeof PUBLICATION_TIMING_OUTCOMES)[number];
  /** The projected publication state of an accepted request (for example ACTIVE). */
  state?: string;
  totalMs: number;
  truncated: boolean;
  spans: {
    id: number;
    parentId: number | null;
    stage: PublicationTimingStage;
    offsetMs: number;
    durationMs: number;
    outcome: 'success' | 'failure' | 'unfinished';
  }[];
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
  'ARTWORK_CLEANUP_NEEDS_REVIEW',
  'MERCHANT_PREVIEW_CLEANUP_UNAVAILABLE',
  'BUYER_PAYLOAD_CLEANUP_UNAVAILABLE',
  'SIGNING_KEY_DESTRUCTION_UNAVAILABLE',
  'PUBLICATION_ABANDONMENT_UNAVAILABLE',
  'PUBLIC_CONFIG_DRIFT',
  'QueueRuntimeError',
  'UNINSTALL_PRIVACY_RECOVERY_UNAVAILABLE',
  'CUSTOMER_PRIVACY_CLEANUP_UNAVAILABLE',
  'SHOP_PRIVACY_FINALIZATION_UNAVAILABLE',
  'SHOP_PRIVACY_DEPENDENCY_PENDING',
  'ShopPrivacyAuthorityRequired',
  'USAGE_QUALIFICATION_UNAVAILABLE',
  'UNINSTALL_ENROLLMENT_UNAVAILABLE',
  'ARTWORK_RUNNER_UNAVAILABLE',
  'ARTWORK_RUNNER_ABORTED',
  'ARTWORK_RUNNER_DEADLINE',
  'LIFECYCLE_CREDENTIAL_MISSING',
  'LIFECYCLE_CREDENTIAL_REAUTH_REQUIRED',
  'LIFECYCLE_INSTALLATION_INACTIVE',
  'EADDRINUSE',
  'EADDRNOTAVAIL',
  'EACCES',
  'LISTEN_FAILED',
] as const;
export type RuntimeErrorClass = (typeof RUNTIME_ERROR_CLASSES)[number];

export interface RuntimeLogDetails {
  timing?: BuyerTimingDiagnostic;
  artworkTiming?: ArtworkTimingDiagnostic;
  /** publication_request_timing only. */
  publicationTiming?: PublicationTimingDiagnostic;
  buyerStage?: BuyerFailureDiagnostic['buyerStage'];
  proposalStage?: BuyerFailureDiagnostic['proposalStage'];
  refusalReason?: BuyerFailureDiagnostic['refusalReason'];
  storefrontMarketId?: string;
  primaryMarketId?: string;
  authStage?: AdminAuthenticationStage;
  providerCode?: AdminProviderDiagnosticCode;
  configAction?: AdminConfigAction;
  rejectionCode?: string;
  /** admin_request_failed only. */
  adminFailure?: AdminFailureDiagnostic;
  /** system_request_failed only. */
  systemFailure?: SystemFailureDiagnostic;
  correlationId?: string;
  inboxId?: string;
  shopId?: string;
  jobId?: string;
  topic?: string;
  queue?: string;
  attempt?: number;
  errorClass?: RuntimeErrorClass | BuyerFailureDiagnostic['errorClass'];
  count?: number;
  /** publication_abandonment only: internal identifiers and bounded codes. */
  configId?: string;
  operationId?: string;
  outcome?: PublicationAbandonmentOutcome;
  reasons?: readonly PublicationAbandonmentReason[];
  /** publication_preparation_stopped only: a bounded upper-snake-case step name. */
  preparationStage?: string;
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

const timingMs = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 86400000;
function publicationTimingDetails(t: PublicationTimingDiagnostic | undefined) {
  if (
    !t ||
    typeof t.correlationId !== 'string' ||
    !UUID.test(t.correlationId) ||
    !PUBLICATION_TIMING_OUTCOMES.includes(t.outcome) ||
    (t.state !== undefined && (typeof t.state !== 'string' || !/^[A-Z][A-Z_]{0,63}$/.test(t.state))) ||
    !timingMs(t.totalMs) ||
    typeof t.truncated !== 'boolean' ||
    !Array.isArray(t.spans) ||
    t.spans.length > 64
  )
    throw new Error('Invalid publication timing diagnostic');
  const ids = new Set<number>();
  const spans = t.spans.map((s) => {
    if (
      !Number.isInteger(s.id) ||
      s.id < 1 ||
      s.id > 64 ||
      ids.has(s.id) ||
      (s.parentId !== null && !ids.has(s.parentId)) ||
      !PUBLICATION_TIMING_STAGES.includes(s.stage) ||
      !timingMs(s.offsetMs) ||
      !timingMs(s.durationMs) ||
      !['success', 'failure', 'unfinished'].includes(s.outcome)
    )
      throw new Error('Invalid publication timing span');
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
    outcome: t.outcome,
    ...(t.state === undefined ? {} : { state: t.state }),
    totalMs: t.totalMs,
    truncated: t.truncated,
    spans,
  };
}

function eventDetails(event: RuntimeEvent, input: RuntimeLogDetails) {
  if (event === 'artwork_request_timing') return artworkTimingDetails(input.artworkTiming);
  if (event === 'publication_request_timing') return publicationTimingDetails(input.publicationTiming);
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
    if (input.refusalReason !== undefined && !MARKET_REFUSAL_REASONS.includes(input.refusalReason))
      throw new Error('Invalid buyer market refusal reason');
    const marketId = (value: unknown) => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
    return {
      buyerStage: input.buyerStage,
      correlationId: input.correlationId,
      errorClass: input.errorClass,
      ...(input.proposalStage === undefined ? {} : { proposalStage: input.proposalStage }),
      ...(input.refusalReason === undefined ? {} : { refusalReason: input.refusalReason }),
      ...(marketId(input.storefrontMarketId) ? { storefrontMarketId: input.storefrontMarketId } : {}),
      ...(marketId(input.primaryMarketId) ? { primaryMarketId: input.primaryMarketId } : {}),
    };
  }
  if (event === 'admin_config_rejected') {
    if (
      !ADMIN_CONFIG_ACTIONS.includes(input.configAction!) ||
      typeof input.rejectionCode !== 'string' ||
      !REJECTION_CODE.test(input.rejectionCode)
    )
      throw new Error('Invalid configuration rejection diagnostic');
    return { configAction: input.configAction, rejectionCode: input.rejectionCode };
  }
  if (event === 'admin_request_failed') {
    const f = input.adminFailure;
    if (
      !f ||
      !ADMIN_FAILURE_ROUTES.includes(f.adminRoute) ||
      !HTTP_METHODS.includes(f.httpMethod) ||
      !validUnexpectedError(f) ||
      (f.correlationId !== undefined && (typeof f.correlationId !== 'string' || !UUID.test(f.correlationId)))
    )
      throw new Error('Invalid admin failure diagnostic');
    return {
      adminRoute: f.adminRoute,
      httpMethod: f.httpMethod,
      ...unexpectedErrorDetails(f),
      ...(f.correlationId === undefined ? {} : { correlationId: f.correlationId }),
    };
  }
  if (event === 'system_request_failed') {
    const f = input.systemFailure;
    if (!f || !SYSTEM_FAILURE_ROUTES.includes(f.systemRoute) || !validUnexpectedError(f))
      throw new Error('Invalid system failure diagnostic');
    return { systemRoute: f.systemRoute, ...unexpectedErrorDetails(f) };
  }
  if (event === 'publication_preparation_stopped') {
    if (typeof input.preparationStage !== 'string' || !REJECTION_CODE.test(input.preparationStage))
      throw new Error('Invalid publication preparation diagnostic');
    return { preparationStage: input.preparationStage };
  }
  if (event === 'publication_abandonment') {
    const id = /^[A-Za-z0-9_-]{1,128}$/;
    if (
      typeof input.shopId !== 'string' ||
      !id.test(input.shopId) ||
      typeof input.configId !== 'string' ||
      !id.test(input.configId) ||
      typeof input.operationId !== 'string' ||
      !id.test(input.operationId) ||
      !PUBLICATION_ABANDONMENT_OUTCOMES.includes(input.outcome!) ||
      !Array.isArray(input.reasons) ||
      input.reasons.length > 8 ||
      !input.reasons.every((reason) => PUBLICATION_ABANDONMENT_REASONS.includes(reason))
    )
      throw new Error('Invalid publication abandonment diagnostic');
    return {
      shopId: input.shopId,
      configId: input.configId,
      operationId: input.operationId,
      outcome: input.outcome,
      reasons: [...input.reasons],
    };
  }
  if (event !== 'admin_authentication') return safeDetails(input);
  if (
    !ADMIN_AUTH_STAGES.includes(input.authStage!) ||
    typeof input.correlationId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.correlationId)
  )
    throw new Error('Invalid authentication diagnostic');
  if (input.providerCode !== undefined && !ADMIN_PROVIDER_CODES.includes(input.providerCode))
    throw new Error('Invalid authentication provider code');
  return {
    authStage: input.authStage,
    ...(input.providerCode === undefined ? {} : { providerCode: input.providerCode }),
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
  const abandonment = new Counter({
    name: 'insignia_publication_abandonment_total',
    help: 'Abandoned publication hold outcomes',
    labelNames: ['outcome'],
    registers: [registry],
  });
  const flaggedHolds = new Gauge({
    name: 'insignia_publication_holds_flagged',
    help: 'Publication availability holds waiting for the operator',
    registers: [registry],
  });
  const artworkCleanupReview = new Gauge({
    name: 'insignia_artwork_cleanup_review_rows',
    help: 'Artwork rows whose cleanup failed 12 consecutive times and needs review',
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
    publicationAbandonment(outcome: PublicationAbandonmentOutcome) {
      abandonment.labels(checkedOutcome(PUBLICATION_ABANDONMENT_OUTCOMES, outcome)).inc();
    },
    publicationHoldsFlagged(count: number) {
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid flagged hold count');
      flaggedHolds.set(count);
    },
    artworkCleanupReview(count: number) {
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid artwork cleanup review count');
      artworkCleanupReview.set(count);
    },
    unresolvedBacklog(count: number) {
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid unresolved backlog');
      backlog.set(count);
    },
  };
  return { logger, metrics, registry };
}

export type Observability = ReturnType<typeof createObservability>;
