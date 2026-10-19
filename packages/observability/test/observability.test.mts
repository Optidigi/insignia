import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { createObservability } from '../dist/index.js';

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
  // @ts-expect-error Tenant identifiers must never become metric labels.
  assert.throws(() => metrics.webhook('shop_105501393179'), /metric outcome/);
  assert.throws(() => metrics.unresolvedBacklog(-1), /backlog/);
  const text = await registry.metrics();
  assert.match(text, /insignia_usage_qualification_pass_total\{outcome="success"\} 1/);
  assert.match(text, /insignia_usage_qualification_pass_total\{outcome="failure"\} 1/);
  assert.match(text, /insignia_webhook_total\{outcome="enqueue_failure"\} 1/);
  assert.match(text, /insignia_unresolved_inbox_backlog 3/);
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
