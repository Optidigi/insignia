import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { encodeAppEvent } from '../../m0-010/src/app-events.ts';
import { contractTerms, validateEffectiveZeroContract, type VerifiedContract } from './contract.ts';
import { readExactPartnerContract, readProtectedVariable } from './partner.ts';
import { RunRegister } from './register.ts';
import { sendWithImmediateUseToken, type ImmediateSendResult } from './token.ts';

const RUN_ID = 'm0-012-real-contract-20260928';
const RUN_ROOT = '/home/serveradmin/.local/share/insignia-public-app/m0-012-run';
const PARTNER_FILE = '/home/serveradmin/.local/share/insignia-public-app/partner-read.env';
const APP_FILE = '/home/serveradmin/.local/share/insignia-public-app/server.env';
const CLIENT_ID = '1443cf6d03d39edae7c101a943c5c684';
const SHOP = 'gid://shopify/Shop/105501393179';
const METER = 'customized_order_paid';
const CYCLE_FROM = '2026-09-28T16:53:01Z';
const CYCLE_UNTIL = '2026-10-28T16:53:01Z';
const ENDPOINT = 'https://api.shopify.com/app/2026-07/events';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export type Label = 'E1' | 'E2' | 'E3';
export type OperatorResult = { kind: 'INITIALIZED' | 'READY'; contract?: VerifiedContract } |
  { kind: 'STOP'; reason: string } |
  { kind: 'ATTEMPT'; label: Label; key: string; outcome: ImmediateSendResult;
    preQuantity: number; beforeTokenObservedAt: string; afterTokenObservedAt: string | null };

function baseline(): VerifiedContract {
  const path = resolve(REPO, 'spikes/m0-012/evidence/baseline/partner-active-after-approval.json');
  const envelope = JSON.parse(readFileSync(path, 'utf8')) as {
    httpStatus: number; body: unknown; observedAt: string };
  const result = validateEffectiveZeroContract(envelope.httpStatus, envelope.body,
    { appId: 'gid://shopify/App/429028933633', shopId: SHOP,
      shopDomain: 'insignia-rewrite-dev.myshopify.com',
      subscriptionId: 'gid://shopify/AppSubscription/38085427483',
      planHandle: 'insignia-dev-zero-20260928', meterHandle: METER,
      cycleFrom: CYCLE_FROM, cycleUntil: CYCLE_UNTIL, maxDistinctUnits: 3,
      observedAt: envelope.observedAt });
  if (result.kind !== 'VERIFIED') throw new Error('bundled baseline invalid');
  return result.contract;
}
const BASELINE_TERMS = contractTerms(baseline());

function key(label: Label): string {
  return createHash('sha256').update(`${RUN_ID}:${label}`).digest('hex').slice(0, 32);
}
function requiredQuantity(label: Label, priorAttempts: number): number {
  return label === 'E1' ? priorAttempts === 0 ? 0 : 1 : label === 'E2' ? 1 : 2;
}
function sourceHead(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
}
function sourceClean(): boolean {
  return execFileSync('git', ['status', '--porcelain', '--', 'spikes/m0-012/src',
    'spikes/m0-012/test', 'spikes/m0-012/evidence/baseline'],
  { cwd: REPO, encoding: 'utf8' }).trim() === '';
}

export interface OperatorPorts {
  root: string;
  sourceHash: string;
  partnerToken: string;
  clientSecret: string;
  now(): string;
  partnerFetch?: typeof fetch;
  tokenFetch?: typeof fetch;
}

async function fresh(ports: OperatorPorts): Promise<VerifiedContract | null> {
  const result = await readExactPartnerContract({ token: ports.partnerToken,
    cycleFrom: CYCLE_FROM, cycleUntil: CYCLE_UNTIL, now: ports.now,
    ...(ports.partnerFetch ? { fetch: ports.partnerFetch } : {}) });
  return result.kind === 'READ' && contractTerms(result.contract) === BASELINE_TERMS
    ? result.contract : null;
}

/** No network mutation; initializes one retained locator only with observed zero usage. */
export async function initializeRun(ports: OperatorPorts): Promise<OperatorResult> {
  const read = await fresh(ports);
  if (!read || read.usage.kind !== 'OBSERVED' || read.usage.quantity !== 0)
    return { kind: 'STOP', reason: 'BASELINE_OR_USAGE' };
  const register = new RunRegister(ports.root);
  const result = await register.initialize({ runId: RUN_ID, endpoint: ENDPOINT,
    sourceHash: ports.sourceHash, createdAt: ports.now() });
  return result.kind === 'INITIALIZED' ? { kind: 'INITIALIZED', contract: read } :
    { kind: 'STOP', reason: 'RUN_HISTORY_OR_LOCK' };
}

/** Each call performs two fixed Partner reads and at most one token / one event POST. */
export async function executeAttempt(label: Label, ports: OperatorPorts): Promise<OperatorResult> {
  const register = new RunRegister(ports.root);
  const inspected = await register.inspect();
  if (inspected.kind !== 'READY' || inspected.state.runId !== RUN_ID ||
      inspected.state.sourceHash !== ports.sourceHash || inspected.state.endpoint !== ENDPOINT)
    return { kind: 'STOP', reason: 'RUN_HISTORY_OR_SOURCE' };
  const state = inspected.state;
  if (Object.values(state.events).some(event => event.attempts.some(attempt =>
    attempt.state !== 'DONE' || attempt.outcome?.kind !== 'HTTP' ||
    attempt.outcome.status !== 202 || attempt.outcome.responseSuccess !== true)))
    return { kind: 'STOP', reason: 'UNRESOLVED_ATTEMPT' };
  const eventKey = key(label);
  const prior = state.events[eventKey]?.attempts.length ?? 0;
  if (label === 'E1' && prior > 1 || label !== 'E1' && prior > 0)
    return { kind: 'STOP', reason: 'LABEL_BUDGET' };
  if (label === 'E1' && prior === 1 &&
      (state.events[eventKey]?.attempts[0]?.outcome?.kind !== 'HTTP' ||
        state.events[eventKey]?.attempts[0]?.outcome?.status !== 202) ||
      label === 'E2' && (state.events[key('E1')]?.attempts.length !== 2) ||
      label === 'E3' && (state.events[key('E2')]?.attempts.length !== 1))
    return { kind: 'STOP', reason: 'SEQUENCE' };

  const current = await fresh(ports);
  const qty = requiredQuantity(label, prior);
  if (!current || current.usage.kind !== 'OBSERVED' || current.usage.quantity !== qty)
    return { kind: 'STOP', reason: 'CONTRACT_OR_METER_BASELINE' };
  const body = state.events[eventKey]?.body ?? encodeAppEvent({
    shop_id: SHOP, event_handle: METER, timestamp: ports.now(),
    idempotency_key: eventKey, attributes: { value: 1 },
  }).body;
  const identity = JSON.parse(body) as { timestamp: string };
  if (Date.parse(identity.timestamp) < Date.parse(CYCLE_FROM) ||
      Date.parse(identity.timestamp) >= Date.parse(CYCLE_UNTIL))
    return { kind: 'STOP', reason: 'EVENT_OUTSIDE_CYCLE' };
  const registered = await register.registerEvent(body);
  if (registered.kind !== 'REGISTERED' && registered.kind !== 'EXISTING')
    return { kind: 'STOP', reason: `REGISTER_${registered.kind}` };
  const reserved = await register.reserveAcquisition(eventKey, body);
  if (reserved.kind !== 'RESERVED') return { kind: 'STOP', reason: `BUDGET_${reserved.kind}` };
  let afterTokenObservedAt: string | null = null;
  const outcome = await sendWithImmediateUseToken({
    clientId: CLIENT_ID, clientSecret: ports.clientSecret, eventUrl: ENDPOINT,
    eventBody: body, ...(ports.tokenFetch ? { fetch: ports.tokenFetch } : {}),
    verifyAfterAcquire: async () => {
      const reread = await fresh(ports);
      if (!reread || reread.usage.kind !== 'OBSERVED' || reread.usage.quantity !== qty)
        return false;
      afterTokenObservedAt = reread.observedAt;
      return true;
    },
    beforeEventDispatch: async () =>
      (await register.markMayDispatch(eventKey, reserved.ordinal)).kind === 'MARKED',
  });
  const recorded = await register.recordOutcome(eventKey, reserved.ordinal, outcome);
  if (recorded.kind !== 'RECORDED') return { kind: 'STOP', reason: 'OUTCOME_HISTORY_AMBIGUOUS' };
  return { kind: 'ATTEMPT', label, key: eventKey, outcome,
    preQuantity: qty, beforeTokenObservedAt: current.observedAt, afterTokenObservedAt };
}

/** Fixed operator CLI. No credential or bearer is printed, accepted as an argument, or stored. */
async function main(): Promise<void> {
  if (!sourceClean()) throw new Error('send-path source is uncommitted');
  const [command, label, extra] = process.argv.slice(2);
  if (extra || !['read', 'init', 'inspect', 'send'].includes(command ?? '') ||
      command === 'send' && !['E1', 'E2', 'E3'].includes(label ?? '') ||
      command !== 'send' && label) throw new Error('fixed command mismatch');
  const root = RUN_ROOT, sourceHash = sourceHead();
  if (command === 'inspect') {
    const state = await new RunRegister(root).inspect();
    console.log(JSON.stringify(state)); return;
  }
  const partnerToken = await readProtectedVariable(PARTNER_FILE, 'SHOPIFY_PARTNER_API_TOKEN');
  if (command === 'read') {
    const read = await fresh({ root, sourceHash, partnerToken, clientSecret: '',
      now: () => new Date().toISOString() });
    console.log(JSON.stringify(read ? { kind: 'READ', contract: read } :
      { kind: 'STOP', reason: 'CONTRACT_MISMATCH' })); return;
  }
  const clientId = await readProtectedVariable(APP_FILE, 'SHOPIFY_API_KEY');
  if (clientId !== CLIENT_ID) throw new Error('app client identity mismatch');
  const clientSecret = await readProtectedVariable(APP_FILE, 'SHOPIFY_API_SECRET');
  const ports = { root, sourceHash, partnerToken, clientSecret,
    now: () => new Date().toISOString() };
  const result = command === 'init' ? await initializeRun(ports) :
    await executeAttempt(label as Label, ports);
  console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => { console.error('M0-012 operator command failed safely'); process.exitCode = 1; });
