import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { createObservability } from '../dist/index.js';

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
  const record = JSON.parse(output.trim());
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
  assert.throws(() => metrics.webhook('shop_105501393179'), /metric outcome/);
  assert.throws(() => metrics.unresolvedBacklog(-1), /backlog/);
  const text = await registry.metrics();
  assert.match(text, /insignia_webhook_total\{outcome="enqueue_failure"\} 1/);
  assert.match(text, /insignia_unresolved_inbox_backlog 3/);
  assert.doesNotMatch(text, /105501393179|shop_id|domain|delivery_id/);
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
    authorization: 'Bearer SECRET',
    accessToken: 'SECRET',
    clientSecret: 'SECRET',
    rawBody: { token: 'SECRET' },
    staffId: 'SECRET',
    sessionId: 'SECRET',
    query: 'id_token=SECRET',
    error: new Error('SECRET'),
  });
  const record = JSON.parse(output.trim());
  assert.equal(record.authStage, 'ONLINE_EXCHANGE_REFRESH_REQUIRED');
  assert.equal(record.correlationId, '01234567-89ab-4cde-8123-456789abcdef');
  assert.equal(record.statusClass, 'refresh');
  assert.equal(typeof record.time, 'number');
  assert.deepEqual(Object.keys(record).sort(), ['authStage', 'correlationId', 'event', 'level', 'statusClass', 'time']);
  assert.doesNotMatch(output, /SECRET|Bearer|staffId|sessionId|rawBody|query|error/);
  assert.throws(() =>
    logger.info('admin_authentication', { authStage: 'SECRET', correlationId: record.correlationId }),
  );
  assert.throws(() => logger.info('admin_authentication', { authStage: record.authStage, correlationId: 'SECRET' }));
  assert.doesNotMatch(output, /SECRET/);
  for (const stage of [
    'INSTALLATION_BOOTSTRAP_CREATED_SUCCEEDED',
    'INSTALLATION_BOOTSTRAP_REUSED_SUCCEEDED',
    'INSTALLATION_BOOTSTRAP_REINSTALLED_SUCCEEDED',
    'INSTALLATION_BOOTSTRAP_IDENTITY_MISMATCH',
    'INSTALLATION_BOOTSTRAP_STALE_STATE',
    'INSTALLATION_BOOTSTRAP_CONFIRMATION_REQUIRED',
    'INSTALLATION_BOOTSTRAP_WRITE_FAILED',
  ]) {
    output = '';
    logger.info('admin_authentication', {
      authStage: stage,
      correlationId: record.correlationId,
      accessToken: 'SECRET',
      staffId: 'SECRET',
      error: new Error('SECRET'),
    });
    const result = JSON.parse(output.trim());
    assert.equal(result.authStage, stage);
    assert.equal(result.statusClass, stage.endsWith('_SUCCEEDED') ? 'success' : 'failure');
    assert.deepEqual(Object.keys(result).sort(), Object.keys(record).sort());
    assert.doesNotMatch(output, /SECRET|staffId|error/);
  }
});
