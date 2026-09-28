import { lstat, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { validateEffectiveZeroContract, type ContractExpectation, type ContractRead } from './contract.ts';

const URL = 'https://partners.shopify.com/4697030/api/2026-07/graphql.json';
const APP = 'gid://shopify/App/429028933633';
const SHOP = 'gid://shopify/Shop/105501393179';
const DOMAIN = 'insignia-rewrite-dev.myshopify.com';
const SUBSCRIPTION = 'gid://shopify/AppSubscription/38085427483';
const PLAN = 'insignia-dev-zero-20260928';
const METER = 'customized_order_paid';
const MAX_BODY = 64 * 1024;

/** Fixed 2026-07 query; no runtime-variable query or destination is accepted. */
export const REAL_ACTIVE_QUERY = `query M0012ExactActive($appId: ID!, $shopId: ID!) {
  activeSubscription(appId: $appId, shopId: $shopId) {
    app { id }
    shop { id myshopifyDomain }
    billingPeriod cancelAtEndOfCycle trialEndsAt
    currentBillingCycle { startTime endTime }
    items {
      handle description discount { __typename }
      price {
        __typename active currency
        ... on FlatRatePrice { amount }
        ... on TieredPrice { tiersMode tiers { upTo amountPerUnit amount } }
      }
      usage { quantity cost { amount currencyCode } }
    }
    pendingUpdate { billingPeriod items { handle } }
    legacySubscriptionId
  }
}`;

export function expectedContract(observedAt: string,
  cycleFrom: string, cycleUntil: string): ContractExpectation {
  return { appId: APP, shopId: SHOP, shopDomain: DOMAIN, subscriptionId: SUBSCRIPTION,
    planHandle: PLAN, meterHandle: METER, cycleFrom, cycleUntil,
    maxDistinctUnits: 3, observedAt };
}

export type PartnerResult = { kind: 'READ'; contract: Extract<ContractRead, {kind:'VERIFIED'}>['contract'] } |
  { kind: 'REJECTED'; reason: string; status?: number };

async function bounded(response: Response): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY))
    throw new Error('oversize');
  if (!response.body) throw new Error('empty');
  const reader = response.body.getReader();
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); throw new Error('oversize'); }
    chunks.push(next.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

/** No token or response body is returned to the caller or written to logs. */
export async function readExactPartnerContract(ports: {
  token: string; cycleFrom: string; cycleUntil: string; now: () => string;
  fetch?: typeof fetch;
}): Promise<PartnerResult> {
  if (!ports.token || /\s/.test(ports.token) || ports.token.length > 8192 ||
      process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0')
    return { kind: 'REJECTED', reason: 'CREDENTIAL_OR_TLS' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await (ports.fetch ?? fetch)(URL, { method: 'POST',
      redirect: 'manual', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': ports.token },
      body: JSON.stringify({ query: REAL_ACTIVE_QUERY, variables: { appId: APP, shopId: SHOP } }) });
    if (response.redirected || response.status >= 300 && response.status < 400 ||
        response.url && response.url !== URL)
      return { kind: 'REJECTED', reason: 'REDIRECT' };
    if (response.status !== 200)
      return { kind: 'REJECTED', reason: response.status === 401 || response.status === 403
        ? 'AUTH' : 'HTTP', status: response.status };
    const body = await bounded(response);
    const read = validateEffectiveZeroContract(response.status, body,
      expectedContract(ports.now(), ports.cycleFrom, ports.cycleUntil));
    return read.kind === 'VERIFIED' ? { kind: 'READ', contract: read.contract } :
      { kind: 'REJECTED', reason: read.reason, status: response.status };
  } catch { return { kind: 'REJECTED', reason: controller.signal.aborted ? 'TIMEOUT' : 'UNAVAILABLE' }; }
  finally { clearTimeout(timer); }
}

/** A fixed local credential file; ownership and mode are checked without printing contents. */
export async function readProtectedVariable(path: string, name: string): Promise<string> {
  const [file, dir] = await Promise.all([lstat(path), lstat(dirname(path))]);
  if (!file.isFile() || file.isSymbolicLink() || !dir.isDirectory() || dir.isSymbolicLink() ||
      file.uid !== process.getuid?.() || dir.uid !== process.getuid?.() ||
      (file.mode & 0o077) !== 0 || (dir.mode & 0o077) !== 0)
    throw new Error('protected credential file permission mismatch');
  const raw = await readFile(path, 'utf8');
  const matches = raw.split(/\r?\n/).filter(line => line.startsWith(`${name}=`));
  if (matches.length !== 1) throw new Error('protected credential variable mismatch');
  const value = matches[0]!.slice(name.length + 1).replace(/^(['"])(.*)\1$/, '$2');
  if (!value || /[\r\n]/.test(value)) throw new Error('protected credential value mismatch');
  return value;
}
