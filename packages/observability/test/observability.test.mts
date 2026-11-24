import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { createObservability, describeUnexpectedError } from '../dist/index.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function parseRecord(line: string): Record<string, unknown> {
  const value: unknown = JSON.parse(line);
  assert(isRecord(value));
  return value;
}
function lastLine(output: string): string {
  const line = output.trim().split('\n').at(-1);
  assert(line !== undefined);
  return line;
}

test('structured runtime events cannot emit arbitrary payload or credential fields', async () => {
  let output = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk;
      callback();
    },
  });
  const { logger } = createObservability({ stream });
  logger.info('webhook_enqueued', {
    inboxId: '01234567-89ab-4cde-8123-456789abcdef',
    topic: 'app/uninstalled',
    // @ts-expect-error Deliberately inject extra private fields to prove runtime omission.
    authorization: 'Bearer synthetic-access-SECRET',
    clientSecret: 'synthetic-client-SECRET',
    hmac: 'synthetic-hmac-SECRET',
    accessToken: 'synthetic-access-SECRET',
    refreshToken: 'synthetic-refresh-SECRET',
    wrappingKey: 'synthetic-key-SECRET',
    rawBody: 'synthetic-body-SECRET',
    payload: { customer: 'synthetic-customer-SECRET' },
    nested: { authorization: 'nested-SECRET' },
  });
  const record = parseRecord(output.trim());
  assert.equal(record.event, 'webhook_enqueued');
  assert.equal(record.inboxId, '01234567-89ab-4cde-8123-456789abcdef');
  assert.equal(record.topic, 'app/uninstalled');
  logger.info('webhook_enqueued', {
    inboxId: 'synthetic-access-SECRET',
    topic: 'customer/SECRET',
    // @ts-expect-error Deliberately inject an unlisted class to prove runtime omission.
    errorClass: 'synthetic-refresh-SECRET',
  });
  assert.doesNotMatch(output, /SECRET|customer|Bearer|rawBody|payload|clientSecret/);
});

test('metric labels are fixed outcomes and never contain tenant or delivery IDs', async () => {
  const { metrics, registry } = createObservability();
  metrics.webhook('received');
  metrics.webhook('duplicate');
  metrics.webhook('rejected');
  metrics.webhook('enqueue_failure');
  metrics.usageQualification('success');
  metrics.usageQualification('failure');
  // @ts-expect-error Invalid metric label must also reject at runtime.
  assert.throws(() => metrics.usageQualification('private-shop-id'), /metric outcome/);
  metrics.inbox('success');
  metrics.inbox('failure');
  metrics.queue('retry');
  metrics.queue('failure');
  metrics.refresh('success');
  metrics.refresh('transient');
  metrics.refresh('reauth_required');
  metrics.refreshContention();
  metrics.resolution('resolved');
  metrics.resolution('unresolved');
  metrics.unresolvedBacklog(3);
  metrics.artworkCleanupReview(2);
  assert.throws(() => metrics.artworkCleanupReview(-1), /artwork cleanup review/);
  // @ts-expect-error Tenant identifiers must never become metric labels.
  assert.throws(() => metrics.webhook('shop_105501393179'), /metric outcome/);
  assert.throws(() => metrics.unresolvedBacklog(-1), /backlog/);
  const text = await registry.metrics();
  assert.match(text, /insignia_usage_qualification_pass_total\{outcome="success"\} 1/);
  assert.match(text, /insignia_usage_qualification_pass_total\{outcome="failure"\} 1/);
  assert.match(text, /insignia_webhook_total\{outcome="enqueue_failure"\} 1/);
  assert.match(text, /insignia_unresolved_inbox_backlog 3/);
  assert.match(text, /insignia_artwork_cleanup_review_rows 2/);
  assert.doesNotMatch(text, /105501393179|shop_id|domain|delivery_id/);
});

test('retention alerts carry only fixed categories and bounded counts', () => {
  let output = '';
  const { logger } = createObservability({
    stream: new Writable({
      write(chunk, _encoding, callback) {
        output += chunk;
        callback();
      },
    }),
  });
  logger.error('queue_job_rejected', {
    errorClass: 'PrivacyRetentionBlocked',
    count: 3,
    // @ts-expect-error Deliberately inject private fields to prove runtime omission.
    customerId: 'SECRET',
    rawBody: 'SECRET',
    error: new Error('SECRET'),
  });
  const record = parseRecord(output.trim());
  assert.equal(record.errorClass, 'PrivacyRetentionBlocked');
  assert.equal(record.count, 3);
  assert.deepEqual(Object.keys(record).sort(), ['count', 'errorClass', 'event', 'level', 'time']);
  assert.doesNotMatch(output, /SECRET|customerId|rawBody/);
});

test('running cleanup failures retain actionable categories without arbitrary error details', () => {
  let output = '';
  const { logger } = createObservability({
    stream: new Writable({
      write(chunk, _encoding, callback) {
        output += chunk;
        callback();
      },
    }),
  });
  for (const errorClass of [
    'ARTWORK_CLEANUP_UNAVAILABLE',
    'MERCHANT_PREVIEW_CLEANUP_UNAVAILABLE',
    'BUYER_PAYLOAD_CLEANUP_UNAVAILABLE',
  ]) {
    // @ts-expect-error Deliberately inject an arbitrary Error to verify omission.
    logger.error('queue_job_rejected', { errorClass, error: new Error('SECRET'), rawBody: 'SECRET' });
    assert.equal(parseRecord(lastLine(output)).errorClass, errorClass);
  }
  // One asset's failure is a warning with its consecutive attempt count; review is its own class (#474).
  logger.warn('queue_job_rejected', { errorClass: 'ARTWORK_CLEANUP_NEEDS_REVIEW', attempt: 12 });
  const { event, errorClass, attempt, level } = parseRecord(lastLine(output));
  assert.deepEqual(
    { event, errorClass, attempt, level },
    { event: 'queue_job_rejected', errorClass: 'ARTWORK_CLEANUP_NEEDS_REVIEW', attempt: 12, level: 40 },
  );
  // @ts-expect-error Deliberately inject an arbitrary Error to verify omission.
  logger.error('queue_job_rejected', { errorClass: 'UNTRUSTED_SECRET', error: new Error('SECRET') });
  assert.equal(parseRecord(lastLine(output)).errorClass, undefined);
  assert.doesNotMatch(output, /SECRET|rawBody/);
});

test('admin auth diagnostics emit only a bounded stage and independent correlation, never identity or secrets', () => {
  let output = '';
  const { logger } = createObservability({
    stream: new Writable({
      write(chunk, _encoding, callback) {
        output += chunk;
        callback();
      },
    }),
  });
  logger.info('admin_authentication', {
    authStage: 'ONLINE_EXCHANGE_REFRESH_REQUIRED',
    correlationId: '01234567-89ab-4cde-8123-456789abcdef',
    // @ts-expect-error Deliberately inject private fields to prove runtime omission.
    authorization: 'Bearer SECRET',
    accessToken: 'SECRET',
    clientSecret: 'SECRET',
    rawBody: { token: 'SECRET' },
    staffId: 'SECRET',
    sessionId: 'SECRET',
    query: 'id_token=SECRET',
    error: new Error('SECRET'),
  });
  const record = parseRecord(output.trim());
  assert(typeof record.correlationId === 'string');
  assert(record.authStage === 'ONLINE_EXCHANGE_REFRESH_REQUIRED');
  const authStage = record.authStage;
  assert.equal(record.authStage, 'ONLINE_EXCHANGE_REFRESH_REQUIRED');
  assert.equal(record.correlationId, '01234567-89ab-4cde-8123-456789abcdef');
  assert.equal(record.statusClass, 'refresh');
  assert.equal(typeof record.time, 'number');
  assert.deepEqual(Object.keys(record).sort(), ['authStage', 'correlationId', 'event', 'level', 'statusClass', 'time']);
  assert.doesNotMatch(output, /SECRET|Bearer|staffId|sessionId|rawBody|query|error/);
  assert.throws(() =>
    // @ts-expect-error Runtime auth-stage admission rejects unknown categories.
    logger.info('admin_authentication', { authStage: 'SECRET', correlationId: record.correlationId }),
  );
  assert.throws(() => logger.info('admin_authentication', { authStage, correlationId: 'SECRET' }));
  assert.doesNotMatch(output, /SECRET/);
  output = '';
  logger.warn('admin_authentication', {
    authStage: 'INSTALLATION_PROVIDER_READ_FAILED',
    providerCode: 'THROTTLED',
    correlationId: record.correlationId,
  });
  const provider = parseRecord(output.trim());
  assert.equal(provider.providerCode, 'THROTTLED');
  assert.equal(provider.level, 40);
  assert.throws(() =>
    logger.warn('admin_authentication', {
      authStage: 'INSTALLATION_PROVIDER_READ_FAILED',
      // @ts-expect-error Provider messages never become a diagnostic code.
      providerCode: 'Throttled: SECRET',
      correlationId: String(record.correlationId),
    }),
  );
  assert.doesNotMatch(output, /SECRET/);
  for (const stage of [
    'BEARER_MISSING',
    'BEARER_MALFORMED',
    'SESSION_TOKEN_SIGNATURE_REJECTED',
    'SESSION_TOKEN_AUDIENCE_REJECTED',
    'SESSION_TOKEN_TIME_REJECTED',
    'SESSION_TOKEN_FORMAT_REJECTED',
    'SESSION_TOKEN_REJECTED',
    'AUTHENTICATED_ACTOR_REJECTED',
    'SESSION_IDENTITY_REJECTED',
    'INSTALLATION_BOOTSTRAP_CREATED_SUCCEEDED',
    'INSTALLATION_BOOTSTRAP_REUSED_SUCCEEDED',
    'INSTALLATION_BOOTSTRAP_REINSTALLED_SUCCEEDED',
    'INSTALLATION_BOOTSTRAP_IDENTITY_MISMATCH',
    'INSTALLATION_BOOTSTRAP_STALE_STATE',
    'INSTALLATION_BOOTSTRAP_CONFIRMATION_REQUIRED',
    'INSTALLATION_BOOTSTRAP_WRITE_FAILED',
  ] as const) {
    output = '';
    logger.info('admin_authentication', {
      authStage: stage,
      correlationId: record.correlationId,
      // @ts-expect-error Deliberately inject private fields to prove runtime omission.
      accessToken: 'SECRET',
      staffId: 'SECRET',
      sessionId: 'SECRET',
      authorization: 'Bearer SECRET',
      rawResponse: { token: 'SECRET' },
      query: 'id_token=SECRET&shop=SECRET&host=SECRET',
      error: new Error('SECRET'),
    });
    const result = parseRecord(output.trim());
    assert.equal(result.authStage, stage);
    assert.equal(result.statusClass, stage.endsWith('_SUCCEEDED') ? 'success' : 'failure');
    assert.deepEqual(Object.keys(result).sort(), Object.keys(record).sort());
    assert.doesNotMatch(output, /SECRET|staffId|error/);
  }
});

test('complete retention counts survive above the sample bound but unsafe or private values are omitted', () => {
  let output = '';
  const { logger } = createObservability({
    stream: new Writable({
      write(chunk, _encoding, callback) {
        output += chunk;
        callback();
      },
    }),
  });
  for (const count of [101, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, -1, 1.5, Infinity, NaN, '101']) {
    logger.error('queue_job_rejected', {
      errorClass: 'PrivacyRetentionBlocked',
      // @ts-expect-error Includes a nonnumeric count to verify runtime omission.
      count,
      rawBody: 'SECRET',
      customerId: 'SECRET',
    });
  }
  const records = output.trim().split('\n').map(parseRecord);
  assert(records[0] && records[1]);
  assert.equal(records[0].count, 101);
  assert.equal(records[1].count, Number.MAX_SAFE_INTEGER);
  for (const record of records.slice(2)) assert.equal(Object.hasOwn(record, 'count'), false);
  assert.doesNotMatch(output, /SECRET|rawBody|customerId/);
});

test('buyer review-required logging retains only its finite diagnostic and correlation fields', () => {
  let output = '';
  const { logger } = createObservability({
    stream: new Writable({
      write(chunk, _encoding, callback) {
        output += chunk;
        callback();
      },
    }),
  });
  logger.error('buyer_request_failed', {
    correlationId: '01234567-89ab-4cde-8123-456789abcdef',
    buyerStage: 'cart-state',
    errorClass: 'ReviewRequired',
    // @ts-expect-error Private payloads must be omitted at runtime too.
    capability: 'private-capability-SECRET',
    properties: { carrier: 'signed-carrier-SECRET' },
    message: 'exception-message-SECRET',
  });
  const entry = parseRecord(output.trim());
  assert.equal(entry.errorClass, 'ReviewRequired');
  assert.equal(entry.buyerStage, 'cart-state');
  assert.equal(entry.correlationId, '01234567-89ab-4cde-8123-456789abcdef');
  assert.doesNotMatch(output, /SECRET|capability|carrier|properties|message/);
});

test('an unexpected guest artwork failure logs as a buyer failure at the artwork stage', () => {
  let output = '';
  const { logger } = createObservability({
    stream: new Writable({
      write(chunk, _encoding, callback) {
        output += chunk;
        callback();
      },
    }),
  });
  logger.error('buyer_request_failed', {
    correlationId: '01234567-89ab-4cde-8123-456789abcdef',
    buyerStage: 'artwork',
    errorClass: 'UnexpectedFailure',
  });
  const entry = parseRecord(output.trim());
  assert.equal(entry.buyerStage, 'artwork');
  assert.equal(entry.errorClass, 'UnexpectedFailure');
  // Guest session issue and the emailed customer-artwork link are buyer-side too.
  for (const buyerStage of ['artwork-session', 'customer-artwork'] as const) {
    logger.error('buyer_request_failed', {
      correlationId: '01234567-89ab-4cde-8123-456789abcdef',
      buyerStage,
      errorClass: 'TypeError',
    });
    assert.deepEqual(parseRecord(lastLine(output)), {
      level: 50,
      time: parseRecord(lastLine(output)).time,
      event: 'buyer_request_failed',
      buyerStage,
      correlationId: '01234567-89ab-4cde-8123-456789abcdef',
      errorClass: 'TypeError',
    });
  }
  for (const buyerStage of ['artwork-sessions', 'customer', '/api/customer-artwork/v1']) {
    assert.throws(
      () =>
        logger.error('buyer_request_failed', {
          correlationId: '01234567-89ab-4cde-8123-456789abcdef',
          buyerStage: buyerStage as never,
          errorClass: 'TypeError',
        }),
      /Invalid buyer failure diagnostic/,
    );
  }
});

test('expected buyer outcomes log as rejections with the same finite fields; BUSY logs at warn', () => {
  let output = '';
  const { logger } = createObservability({
    stream: new Writable({
      write(chunk, _encoding, callback) {
        output += chunk;
        callback();
      },
    }),
  });
  logger.info('buyer_request_rejected', {
    correlationId: '01234567-89ab-4cde-8123-456789abcdef',
    buyerStage: 'quote-proposals',
    errorClass: 'DatabaseLockTimeout',
    // @ts-expect-error Private payloads must be omitted at runtime too.
    message: 'exception-message-SECRET',
  });
  const entry = parseRecord(output.trim());
  assert.equal(entry.level, 30);
  assert.equal(entry.event, 'buyer_request_rejected');
  assert.equal(entry.errorClass, 'DatabaseLockTimeout');
  assert.doesNotMatch(output, /SECRET|message/);
  output = '';
  // Sustained lock timeouts and Shopify throttling stay visible above info.
  logger.warn('buyer_request_rejected', {
    correlationId: '01234567-89ab-4cde-8123-456789abcdef',
    buyerStage: 'quote-proposals',
    errorClass: 'ProviderReadUnavailable',
    // @ts-expect-error Private payloads must be omitted at runtime too.
    message: 'exception-message-SECRET',
  });
  const warned = parseRecord(output.trim());
  assert.equal(warned.level, 40);
  assert.equal(warned.errorClass, 'ProviderReadUnavailable');
  assert.doesNotMatch(output, /SECRET|message/);
  assert.throws(
    () =>
      logger.info('buyer_request_rejected', {
        correlationId: '01234567-89ab-4cde-8123-456789abcdef',
        buyerStage: 'quote-proposals',
        // @ts-expect-error Deliberately inject an unlisted class to prove runtime rejection.
        errorClass: 'SECRET-class',
      }),
    /Invalid buyer failure diagnostic/,
  );
});

test('proposal failure stage is finite, optional, and never serializes secret-bearing errors', () => {
  let output = '';
  const { logger } = createObservability({
    stream: new Writable({
      write(chunk, _encoding, callback) {
        output += chunk;
        callback();
      },
    }),
  });
  logger.error('buyer_request_failed', {
    correlationId: '01234567-89ab-4cde-8123-456789abcdef',
    buyerStage: 'quote-proposals',
    errorClass: 'UnexpectedFailure',
    proposalStage: 'persistence',
    // @ts-expect-error Runtime privacy check includes forbidden fields.
    error: Object.assign(new Error('SECRET-message'), { cause: new Error('SECRET-cause') }),
    stack: 'SECRET-stack',
    payload: 'SECRET-payload',
  });
  assert.equal(parseRecord(output.trim()).proposalStage, 'persistence');
  assert.doesNotMatch(output, /SECRET|message|stack|payload|cause/);
  assert.throws(
    () =>
      logger.error('buyer_request_failed', {
        correlationId: '01234567-89ab-4cde-8123-456789abcdef',
        buyerStage: 'quote-proposals',
        errorClass: 'UnexpectedFailure',
        // @ts-expect-error Deliberately invalid diagnostic stage.
        proposalStage: 'SECRET-url',
      }),
    /Invalid buyer proposal failure stage/,
  );
});

test('buyer timing summaries whitelist every nested span and reject unbounded payloads', () => {
  let output = '';
  const { logger } = createObservability({
    stream: new Writable({
      write(chunk, _encoding, callback) {
        output += chunk;
        callback();
      },
    }),
  });
  const timing = {
    correlationId: '01234567-89ab-4cde-8123-456789abcdef',
    operation: 'proposal' as const,
    outcome: 'success' as const,
    totalMs: 20,
    truncated: false,
    spans: [
      {
        id: 1,
        parentId: null,
        stage: 'prepare' as const,
        offsetMs: 0,
        durationMs: 20,
        outcome: 'success' as const,
        secret: 'SECRET',
      },
    ],
    secret: 'SECRET',
  };
  logger.info('buyer_request_timing', { timing });
  assert.equal(parseRecord(output.trim()).totalMs, 20);
  assert.doesNotMatch(output, /SECRET|secret/);
  assert.throws(
    () => logger.info('buyer_request_timing', { timing: { ...timing, spans: Array(65).fill(timing.spans[0]) } }),
    /timing/,
  );
  assert.throws(() => logger.info('buyer_request_timing', { timing: { ...timing, totalMs: Infinity } }), /timing/);
  const first = timing.spans[0];
  assert.ok(first);
  output = '';
  logger.info('buyer_request_timing', {
    timing: { ...timing, outcome: 'failure', spans: [{ ...first, outcome: 'unfinished' }] },
  });
  assert.match(output, /"outcome":"unfinished"/);
  assert.doesNotMatch(output, /SECRET|secret/);
  assert.throws(
    () =>
      logger.info('buyer_request_timing', {
        timing: { ...timing, spans: [{ ...first, stage: 'SECRET' as never }] },
      }),
    /timing/,
  );
});

test('guest artwork timing lines whitelist a bounded vocabulary', () => {
  let output = '';
  const { logger } = createObservability({
    stream: new Writable({
      write(chunk, _encoding, callback) {
        output += chunk;
        callback();
      },
    }),
  });
  const artworkTiming = {
    correlationId: '01234567-89ab-4cde-8123-456789abcdef',
    operation: 'status' as const,
    outcome: 'success' as const,
    httpStatus: 200,
    totalMs: 12,
    assetId: 'ae771020-1f54-47ab-a8af-48b1eb7de3d2',
    state: 'INSPECTING' as const,
    secret: 'SECRET',
  };
  logger.info('artwork_request_timing', { artworkTiming });
  const line = parseRecord(output.trim());
  assert.equal(line.event, 'artwork_request_timing');
  assert.equal(line.operation, 'status');
  assert.equal(line.state, 'INSPECTING');
  assert.equal(line.assetId, artworkTiming.assetId);
  assert.doesNotMatch(output, /SECRET|secret/);
  output = '';
  logger.info('artwork_request_timing', {
    artworkTiming: {
      ...artworkTiming,
      operation: 'begin',
      outcome: 'failure',
      httpStatus: 503,
      failure: 'INSPECTION_UNAVAILABLE',
      assetId: undefined,
      state: undefined,
    },
  });
  assert.match(output, /"failure":"INSPECTION_UNAVAILABLE"/);
  output = '';
  logger.info('artwork_request_timing', {
    artworkTiming: {
      ...artworkTiming,
      operation: 'begin',
      outcome: 'failure',
      httpStatus: 429,
      failure: 'RATE_LIMITED',
      assetId: undefined,
      state: undefined,
    },
  });
  assert.match(output, /"failure":"RATE_LIMITED"/);
  for (const invalid of [
    { ...artworkTiming, operation: 'download' },
    { ...artworkTiming, totalMs: -1 },
    { ...artworkTiming, httpStatus: 99 },
    { ...artworkTiming, state: 'SECRET' },
    { ...artworkTiming, failure: 'SECRET' },
    { ...artworkTiming, assetId: 'not-an-asset' },
    { ...artworkTiming, correlationId: 'SECRET' },
  ])
    assert.throws(() => logger.info('artwork_request_timing', { artworkTiming: invalid as never }), /artwork timing/);
});

test('admin configuration rejections log only the command and a bounded reason code', () => {
  let output = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk;
      callback();
    },
  });
  const { logger } = createObservability({ stream });
  logger.info('admin_config_rejected', {
    configAction: 'save',
    rejectionCode: 'CONFIG_POLICY_INVALID',
    // @ts-expect-error Deliberately inject merchant content to prove runtime omission.
    draft: { title: 'SECRET' },
    message: 'SECRET',
    path: 'selectedSetup.SECRET',
  });
  const entry = parseRecord(lastLine(output));
  assert.deepEqual(entry, {
    level: 30,
    time: entry.time,
    event: 'admin_config_rejected',
    configAction: 'save',
    rejectionCode: 'CONFIG_POLICY_INVALID',
  });
  assert.throws(() => logger.info('admin_config_rejected', { configAction: 'save', rejectionCode: 'secret text' }));
  assert.throws(() =>
    // @ts-expect-error Unknown command actions are rejected.
    logger.info('admin_config_rejected', { configAction: 'SECRET', rejectionCode: 'DRAFT_INVALID' }),
  );
  assert.doesNotMatch(output, /SECRET|secret text/);
});

test('a stopped publication preparation logs only its bounded step name', () => {
  let output = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk;
      callback();
    },
  });
  const { logger } = createObservability({ stream });
  logger.warn('publication_preparation_stopped', {
    preparationStage: 'SIGNING_AFTER_READ_CONFIG_BEFORE',
    // @ts-expect-error Deliberately inject private content to prove runtime omission.
    idToken: 'SECRET',
    shopId: 'SECRET',
  });
  const entry = parseRecord(lastLine(output));
  assert.deepEqual(entry, {
    level: 40,
    time: entry.time,
    event: 'publication_preparation_stopped',
    preparationStage: 'SIGNING_AFTER_READ_CONFIG_BEFORE',
  });
  assert.throws(() => logger.warn('publication_preparation_stopped', { preparationStage: 'secret text' }));
  assert.throws(() => logger.warn('publication_preparation_stopped', {}));
  assert.doesNotMatch(output, /SECRET|secret text/);
});

test('an unexpected admin failure logs only its route, method, class, code and own-code site', () => {
  let output = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk;
      callback();
    },
  });
  const { logger } = createObservability({ stream });
  logger.error('admin_request_failed', {
    adminFailure: {
      adminRoute: 'product-config-command',
      httpMethod: 'POST',
      errorClass: 'DatabaseError',
      errorCode: '42P01',
      errorSite: 'dist/server/chunks/merchant-config_Ab1-c.mjs:120',
      correlationId: '01234567-89ab-4cde-8123-456789abcdef',
      // @ts-expect-error Deliberately inject private content to prove runtime omission.
      message: 'SECRET',
    },
    shopId: '01234567-89ab-4cde-8123-456789abcdef',
  });
  const entry = parseRecord(lastLine(output));
  assert.deepEqual(entry, {
    level: 50,
    time: entry.time,
    event: 'admin_request_failed',
    adminRoute: 'product-config-command',
    httpMethod: 'POST',
    errorClass: 'DatabaseError',
    errorCode: '42P01',
    errorSite: 'dist/server/chunks/merchant-config_Ab1-c.mjs:120',
    correlationId: '01234567-89ab-4cde-8123-456789abcdef',
  });
  logger.error('admin_request_failed', {
    adminFailure: { adminRoute: 'catalog', httpMethod: 'GET', errorClass: 'Error' },
  });
  assert.deepEqual(Object.keys(parseRecord(lastLine(output))).sort(), [
    'adminRoute',
    'errorClass',
    'event',
    'httpMethod',
    'level',
    'time',
  ]);
  for (const adminRoute of [
    'preferences',
    'merchant-media',
    'merchant-artwork',
    'artwork-link',
    'purchases',
  ] as const) {
    logger.error('admin_request_failed', { adminFailure: { adminRoute, httpMethod: 'POST', errorClass: 'Error' } });
    assert.equal(parseRecord(lastLine(output)).adminRoute, adminRoute);
  }
  const valid = { adminRoute: 'catalog', httpMethod: 'GET', errorClass: 'Error' } as const;
  const invalidFailures: unknown[] = [
    {},
    { ...valid, adminRoute: '/api/admin/products/123/config' },
    { ...valid, httpMethod: 'SECRET' },
    { ...valid, errorClass: 'connection to db.secret.example failed' },
    { ...valid, errorClass: `E${'x'.repeat(64)}` },
    { ...valid, errorCode: 'secret text' },
    { ...valid, errorCode: `E${'X'.repeat(64)}` },
    { ...valid, errorSite: '/home/secret/apps/web/src/server/x.ts:1' },
    { ...valid, errorSite: 'dist/server/x.mjs:1 password=secret' },
    { ...valid, errorSite: 'dist/server/x.mjs?token=secret:1' },
    { ...valid, errorSite: `dist/${'a/'.repeat(120)}x.mjs:1` },
    { ...valid, correlationId: 'secret text' },
    { ...valid, adminRoute: 'purchase' },
  ];
  for (const invalid of invalidFailures)
    assert.throws(() => logger.error('admin_request_failed', { adminFailure: invalid as never }));
  assert.doesNotMatch(output, /SECRET|secret/);
});

test('an unexpected webhook or operator failure logs only its route, class, code and own-code site', () => {
  let output = '';
  const { logger } = createObservability({
    stream: new Writable({
      write(chunk, _encoding, callback) {
        output += chunk;
        callback();
      },
    }),
  });
  logger.error('system_request_failed', {
    systemFailure: {
      systemRoute: 'shopify-webhook',
      errorClass: 'DatabaseError',
      errorCode: '57P01',
      errorSite: 'dist/server/chunks/shopify-webhook_Ab1-c.mjs:88',
      // @ts-expect-error Private payloads must be omitted at runtime too.
      message: 'hmac=SECRET for shop.myshopify.com',
    },
    ...({ shopDomain: 'shop.myshopify.com' } as object),
  });
  const entry = parseRecord(lastLine(output));
  assert.deepEqual(entry, {
    level: 50,
    time: entry.time,
    event: 'system_request_failed',
    systemRoute: 'shopify-webhook',
    errorClass: 'DatabaseError',
    errorCode: '57P01',
    errorSite: 'dist/server/chunks/shopify-webhook_Ab1-c.mjs:88',
  });
  for (const systemRoute of ['shopify-webhook', 'shopify-webhook-setup', 'internal-metrics'] as const) {
    logger.error('system_request_failed', { systemFailure: { systemRoute, errorClass: 'Error' } });
    assert.deepEqual(Object.keys(parseRecord(lastLine(output))).sort(), [
      'errorClass',
      'event',
      'level',
      'systemRoute',
      'time',
    ]);
    assert.equal(parseRecord(lastLine(output)).systemRoute, systemRoute);
  }
  const valid = { systemRoute: 'internal-metrics', errorClass: 'Error' } as const;
  const invalidFailures: unknown[] = [
    undefined,
    {},
    { ...valid, systemRoute: '/api/webhooks/uninstall/abc' },
    { ...valid, systemRoute: 'catalog' },
    { ...valid, errorClass: 'connection to db.secret.example failed' },
    { ...valid, errorCode: 'secret text' },
    { ...valid, errorSite: '/home/secret/apps/web/src/server/x.ts:1' },
  ];
  for (const invalid of invalidFailures)
    assert.throws(
      () => logger.error('system_request_failed', { systemFailure: invalid as never }),
      /Invalid system failure diagnostic/,
    );
  assert.doesNotMatch(output, /SECRET|secret|myshopify|message/);
});

test('an unexpected error is reduced to its class, short code and first own-code frame', () => {
  const error = Object.assign(new TypeError('token=SECRET for shop.myshopify.com'), { code: 'ERR_SECRET_THING' });
  error.stack = [
    'TypeError: token=SECRET for shop.myshopify.com',
    '    at Parser.parse (/srv/insignia/web/node_modules/.pnpm/pg@8.16.3/node_modules/pg/lib/parser.js:10:3)',
    '    at node:internal/process/task_queues:105:5',
    '    at read (file:///srv/insignia/web/dist/server/chunks/merchant-config_Ab1-c.mjs?v=SECRET:120:7)',
    '    at handle (/srv/insignia/web/dist/server/entry.mjs:9:1)',
  ].join('\n');
  assert.deepEqual(describeUnexpectedError(error), {
    errorClass: 'TypeError',
    errorCode: 'ERR_SECRET_THING',
    errorSite: 'dist/server/chunks/merchant-config_Ab1-c.mjs:120',
  });
  const workspace = new Error('x');
  workspace.stack =
    'Error: x\n    at Object.<anonymous> (/srv/insignia/web/node_modules/@insignia/database/dist/core.js:44:9)';
  assert.deepEqual(describeUnexpectedError(workspace), {
    errorClass: 'Error',
    errorSite: '@insignia/database/dist/core.js:44',
  });
  const source = new Error('x');
  source.stack = 'Error: x\n    at /home/someone/insignia/apps/web/src/server/admin/http.ts:451:11';
  assert.deepEqual(describeUnexpectedError(source), {
    errorClass: 'Error',
    errorSite: 'apps/web/src/server/admin/http.ts:451',
  });
  class Bad extends Error {}
  Object.defineProperty(Bad, 'name', { value: 'not a class name' });
  const thirdParty = Object.assign(new Bad('x'), { code: 'lower case secret' });
  thirdParty.stack = 'Error: x\n    at f (/srv/insignia/web/node_modules/pg/lib/client.js:1:1)';
  assert.deepEqual(describeUnexpectedError(thirdParty), { errorClass: 'Error' });
  assert.deepEqual(describeUnexpectedError('SECRET'), { errorClass: 'Error' });
  assert.deepEqual(describeUnexpectedError(null), { errorClass: 'Error' });
});

test('publication timing lines whitelist a bounded stage vocabulary and integer milliseconds', () => {
  let output = '';
  const { logger } = createObservability({
    stream: new Writable({
      write(chunk, _encoding, callback) {
        output += chunk;
        callback();
      },
    }),
  });
  const span = {
    id: 1,
    parentId: null,
    stage: 'preparation' as const,
    offsetMs: 120,
    durationMs: 5400,
    outcome: 'success' as const,
    secret: 'SECRET',
  };
  const publicationTiming = {
    correlationId: '01234567-89ab-4cde-8123-456789abcdef',
    outcome: 'accepted' as const,
    state: 'ACTIVE',
    totalMs: 31000,
    truncated: false,
    spans: [span, { ...span, id: 2, parentId: 1, stage: 'release-collect' as const, offsetMs: 300 }],
    shop: 'SECRET.myshopify.com',
  };
  logger.info('publication_request_timing', { publicationTiming });
  const line = parseRecord(lastLine(output));
  assert.equal(line.event, 'publication_request_timing');
  assert.equal(line.totalMs, 31000);
  assert.equal(line.outcome, 'accepted');
  assert.equal(line.state, 'ACTIVE');
  assert.deepEqual(
    (line.spans as Record<string, unknown>[]).map((item) => [item.id, item.parentId, item.stage]),
    [
      [1, null, 'preparation'],
      [2, 1, 'release-collect'],
    ],
  );
  assert.doesNotMatch(output, /SECRET|secret/);
  output = '';
  logger.info('publication_request_timing', {
    publicationTiming: { ...publicationTiming, outcome: 'failure', state: undefined },
  });
  assert.doesNotMatch(lastLine(output), /"state"/);
  for (const invalid of [
    { ...publicationTiming, totalMs: 1.5 },
    { ...publicationTiming, outcome: 'SECRET' },
    { ...publicationTiming, state: 'shop.myshopify.com' },
    { ...publicationTiming, correlationId: 'SECRET' },
    { ...publicationTiming, spans: Array.from({ length: 65 }, (_, index) => ({ ...span, id: index + 1 })) },
    { ...publicationTiming, spans: [{ ...span, stage: 'SECRET' }] },
    { ...publicationTiming, spans: [{ ...span, parentId: 7 }] },
    { ...publicationTiming, spans: [{ ...span, durationMs: -1 }] },
  ])
    assert.throws(
      () => logger.info('publication_request_timing', { publicationTiming: invalid as never }),
      /publication timing/,
    );
});

test('market refusal reason and numeric Market IDs pass the buyer filter; anything else is rejected or dropped', () => {
  let output = '';
  const { logger } = createObservability({
    stream: new Writable({
      write(chunk, _encoding, callback) {
        output += chunk;
        callback();
      },
    }),
  });
  const base = {
    correlationId: '01234567-89ab-4cde-8123-456789abcdef',
    buyerStage: 'config',
    errorClass: 'UnsupportedMarket',
  } as const;
  logger.info('buyer_request_rejected', {
    ...base,
    refusalReason: 'MARKET_NOT_PRIMARY',
    storefrontMarketId: '99',
    primaryMarketId: '42',
  });
  const entry = parseRecord(output.trim());
  assert.equal(entry.refusalReason, 'MARKET_NOT_PRIMARY');
  assert.equal(entry.storefrontMarketId, '99');
  assert.equal(entry.primaryMarketId, '42');
  output = '';
  // Absent or malformed IDs are omitted, never logged as empty strings or free text.
  logger.info('buyer_request_rejected', {
    ...base,
    refusalReason: 'CURRENCY_MISMATCH',
    storefrontMarketId: '',
    primaryMarketId: 'SECRET-gid',
  });
  const dropped = parseRecord(output.trim());
  assert.equal(dropped.refusalReason, 'CURRENCY_MISMATCH');
  assert.equal('storefrontMarketId' in dropped, false);
  assert.equal('primaryMarketId' in dropped, false);
  assert.doesNotMatch(output, /SECRET/);
  assert.throws(
    () =>
      logger.info('buyer_request_rejected', {
        ...base,
        // @ts-expect-error Deliberately inject an unlisted reason to prove runtime rejection.
        refusalReason: 'SECRET-reason',
      }),
    /Invalid buyer market refusal reason/,
  );
});

test('a buyer failure names its provider failure kind from a finite vocabulary, never provider text', () => {
  let output = '';
  const { logger } = createObservability({
    stream: new Writable({
      write(chunk, _encoding, callback) {
        output += chunk;
        callback();
      },
    }),
  });
  const base = {
    correlationId: '01234567-89ab-4cde-8123-456789abcdef',
    buyerStage: 'quote-proposals',
    errorClass: 'ProviderReadUnavailable',
    proposalStage: 'availability',
  } as const;
  logger.error('buyer_request_failed', { ...base, providerKind: 'catalog.graphql_error' });
  assert.equal(parseRecord(lastLine(output)).providerKind, 'catalog.graphql_error');
  logger.warn('buyer_request_rejected', { ...base, providerKind: 'shopify_admin.internal_server_error' });
  assert.equal(parseRecord(lastLine(output)).providerKind, 'shopify_admin.internal_server_error');
  // An unlisted kind is omitted; the failure itself is still logged.
  output = '';
  // @ts-expect-error Deliberately inject an unlisted kind to prove runtime omission.
  logger.error('buyer_request_failed', { ...base, providerKind: 'SECRET https://synthetic.myshopify.com' });
  const dropped = parseRecord(output.trim());
  assert.equal(dropped.errorClass, 'ProviderReadUnavailable');
  assert.equal('providerKind' in dropped, false);
  assert.doesNotMatch(output, /SECRET|myshopify/);
});
