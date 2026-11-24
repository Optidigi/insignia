import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseRepairState,
  type RepairCause,
  type RepairState,
  repairOffers,
  repairView,
} from '../src/designer/repair-state.ts';

const summary = (state: RepairState) => {
  const view = repairView(state);
  return {
    heading: view.heading,
    label: view.label,
    help: view.help,
    actions: view.actions.map((offer) => `${offer.action}${offer.primary ? '*' : ''}:${offer.label}`),
  };
};
const repairRequired = {
  heading: 'customer:recovery.repairRequired',
  label: 'customer:recovery.repairRequired',
  help: 'customer:recovery.repairHelp',
} as const;
const removeGroup = 'remove-group:customer:recovery.removeGroup';
const removeAll = 'remove-all:customer:recovery.removeAll';
const retry = 'retry:common:actions.retry';

const cases: { state: RepairState; view: ReturnType<typeof summary> }[] = [
  {
    state: { cause: 'cart-changed' },
    view: { ...repairRequired, actions: ['start*:customer:recovery.reopenFromCart', removeAll, retry] },
  },
  {
    state: { cause: 'earlier-session', lines: 'valid', canRemoveAll: true },
    view: {
      heading: 'customer:recovery.earlierSession',
      label: 'customer:recovery.earlierSession',
      help: 'customer:recovery.earlierSessionHelp',
      actions: ['cart*:customer:chrome.viewCart', removeAll],
    },
  },
  {
    state: { cause: 'earlier-session', lines: 'expired', canRemoveAll: false },
    view: {
      heading: 'customer:recovery.earlierSession',
      label: 'customer:recovery.earlierSession',
      help: 'customer:recovery.earlierSessionExpiredHelp',
      actions: [],
    },
  },
  { state: { cause: 'unresolved-write' }, view: { ...repairRequired, actions: [removeAll, retry] } },
  { state: { cause: 'unavailable', canRemoveAll: true }, view: { ...repairRequired, actions: [removeAll, retry] } },
  {
    // Nothing to remove or start: the buyer is told plainly that customization isn't available now.
    state: { cause: 'unavailable', canRemoveAll: false },
    view: {
      heading: 'customer:chrome.unavailable',
      label: 'customer:recovery.repairRequired',
      help: 'customer:recovery.unavailableHelp',
      actions: [retry],
    },
  },
  {
    state: { cause: 'review-required', canStart: false, canRemoveGroup: false, canRemoveAll: false },
    view: {
      heading: 'customer:chrome.unavailable',
      label: 'customer:recovery.repairRequired',
      help: 'customer:recovery.unavailableHelp',
      actions: [retry],
    },
  },
  {
    state: { cause: 'review-required', canStart: true, canRemoveGroup: true, canRemoveAll: true },
    view: { ...repairRequired, actions: ['start*:customer:recovery.startNew', removeGroup, removeAll, retry] },
  },
  {
    state: { cause: 'review-required', canStart: false, canRemoveGroup: false, canRemoveAll: true },
    view: { ...repairRequired, actions: [removeAll, retry] },
  },
  {
    // Nothing in the cart to remove: the customization is simply unavailable.
    state: { cause: 'review-required', canStart: true, canRemoveGroup: false, canRemoveAll: false },
    view: {
      heading: 'customer:chrome.unavailable',
      label: 'customer:recovery.repairRequired',
      help: undefined,
      actions: ['start*:customer:recovery.startNew', retry],
    },
  },
  {
    // The storefront's country or Market is not supported: say so at once and lead with removal. Retry and Start
    // cannot change the context, so neither is offered.
    state: { cause: 'unsupported-context', canRemoveAll: true },
    view: {
      heading: 'customer:chrome.unavailable',
      label: 'customer:chrome.unavailable',
      help: 'customer:recovery.unsupportedMarket',
      actions: ['remove-all*:customer:recovery.removeAll'],
    },
  },
  {
    state: { cause: 'unsupported-context', canRemoveAll: false },
    view: {
      heading: 'customer:chrome.unavailable',
      label: 'customer:chrome.unavailable',
      help: 'customer:recovery.unsupportedMarket',
      actions: [],
    },
  },
];

test('every repair cause derives its copy and actions in one place', () => {
  const covered = new Set<RepairCause>(cases.map(({ state }) => state.cause));
  assert.deepEqual([...covered].sort(), [
    'cart-changed',
    'earlier-session',
    'review-required',
    'unavailable',
    'unresolved-write',
    'unsupported-context',
  ]);
  for (const { state, view } of cases) assert.deepEqual(summary(state), view, state.cause);
});

test('only an offered action is reported as offered', () => {
  assert.equal(repairOffers({ cause: 'cart-changed' }, 'start'), true);
  assert.equal(repairOffers({ cause: 'earlier-session', lines: 'valid', canRemoveAll: true }, 'start'), false);
  assert.equal(repairOffers({ cause: 'earlier-session', lines: 'valid', canRemoveAll: true }, 'retry'), false);
  assert.equal(repairOffers({ cause: 'unresolved-write' }, 'remove-all'), true);
  assert.equal(repairOffers(undefined, 'start'), false);
  assert.equal(repairOffers({ cause: 'unsupported-context', canRemoveAll: true }, 'remove-all'), true);
  assert.equal(repairOffers({ cause: 'unsupported-context', canRemoveAll: true }, 'start'), false);
  assert.equal(repairOffers({ cause: 'unsupported-context', canRemoveAll: true }, 'retry'), false);
});

test('a repair state crossing the frame is rebuilt from its own fields only', () => {
  for (const { state } of cases) assert.deepEqual(parseRepairState(structuredClone(state)), state);
  // Fields of another cause are dropped, never rendered.
  assert.deepEqual(
    parseRepairState({
      cause: 'earlier-session',
      lines: 'valid',
      canRemoveAll: true,
      canStart: true,
      reopensCartLine: true,
    }),
    { cause: 'earlier-session', lines: 'valid', canRemoveAll: true },
  );
  assert.deepEqual(parseRepairState({ cause: 'cart-changed', canRemoveGroup: true }), { cause: 'cart-changed' });
  for (const invalid of [
    undefined,
    null,
    'cart-changed',
    { canStart: true, canRemoveGroup: false },
    { cause: 'unknown' },
    { cause: 'unavailable' },
    { cause: 'unsupported-context' },
    { cause: 'earlier-session', lines: 'other', canRemoveAll: true },
    { cause: 'earlier-session', lines: 'valid' },
    { cause: 'review-required', canStart: true, canRemoveGroup: 'yes', canRemoveAll: true },
  ])
    assert.equal(parseRepairState(invalid), undefined, JSON.stringify(invalid));
});
