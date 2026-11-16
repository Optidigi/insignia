import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type CustomerEmailSettingEvent,
  type CustomerEmailSettingState,
  customerEmailSettingChecked,
  customerEmailSettingReducer,
  initialCustomerEmailSettingState,
} from '../../src/shared/customer-email-setting-state.ts';

const run = (events: CustomerEmailSettingEvent[], from = initialCustomerEmailSettingState()) =>
  events.reduce<CustomerEmailSettingState>(customerEmailSettingReducer, from);
const ready = (enabled = true, canEdit = true) =>
  run([
    { type: 'load-started', generation: 1 },
    { type: 'loaded', generation: 1, enabled, canEdit },
  ]);

test('the switch shows nothing until the store choice is read, then the server value', () => {
  assert.equal(customerEmailSettingChecked(initialCustomerEmailSettingState()), null);
  assert.equal(customerEmailSettingChecked(ready(true)), true);
  assert.equal(customerEmailSettingChecked(ready(false)), false);
  assert.equal(
    run([{ type: 'load-failed', generation: 1 }], run([{ type: 'load-started', generation: 1 }])).phase,
    'unavailable',
  );
});

test('a change shows the requested value only while it is saved, then the confirmed value', () => {
  const saving = run([{ type: 'change-requested', operation: 1, enabled: false }], ready(true));
  assert.equal(saving.phase, 'saving');
  assert.equal(customerEmailSettingChecked(saving), false);
  const saved = run([{ type: 'save-succeeded', operation: 1, enabled: false }], saving);
  assert.deepEqual(saved, { phase: 'ready', generation: 1, operation: 1, enabled: false, canEdit: true, notice: null });
});

test('a failed, busy or conflicting save settles back to the last confirmed value with its own notice', () => {
  const saving = run([{ type: 'change-requested', operation: 1, enabled: false }], ready(true));
  for (const [event, notice] of [
    [{ type: 'save-failed', operation: 1, reason: 'failed' }, 'save-failed'],
    [{ type: 'save-failed', operation: 1, reason: 'busy' }, 'busy'],
    [{ type: 'save-conflicted', operation: 1 }, 'changed-elsewhere'],
  ] as const) {
    const after = run([event], saving);
    assert.equal(customerEmailSettingChecked(after), true, notice);
    assert.equal(after.phase === 'ready' && after.notice, notice);
  }
  // After a conflict the page reads the current value again; the notice stays until it is shown with it.
  const reread = run(
    [
      { type: 'save-conflicted', operation: 1 },
      { type: 'load-started', generation: 2 },
      { type: 'loaded', generation: 2, enabled: false, canEdit: true },
    ],
    saving,
  );
  assert.deepEqual(reread, {
    phase: 'ready',
    generation: 2,
    operation: 1,
    enabled: false,
    canEdit: true,
    notice: 'changed-elsewhere',
  });
});

test('late, stale or unauthorized events change nothing', () => {
  const saving = run([{ type: 'change-requested', operation: 2, enabled: false }], ready(true));
  assert.equal(run([{ type: 'save-succeeded', operation: 1, enabled: false }], saving), saving, 'older operation');
  assert.equal(run([{ type: 'change-requested', operation: 3, enabled: true }], saving), saving, 'one save at a time');
  assert.equal(run([{ type: 'load-started', generation: 2 }], saving), saving, 'a reload waits for the save');
  assert.equal(run([{ type: 'loaded', generation: 7, enabled: false, canEdit: true }], ready()).phase, 'ready');
  const readOnly = ready(true, false);
  assert.equal(
    run([{ type: 'change-requested', operation: 1, enabled: false }], readOnly),
    readOnly,
    'read-only staff',
  );
  const same = ready(true);
  assert.equal(run([{ type: 'change-requested', operation: 1, enabled: true }], same), same, 'no-op change');
  assert.equal(run([{ type: 'loaded', generation: 1, enabled: false, canEdit: true }], same), same, 'not loading');
});
