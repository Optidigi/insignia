import { createHash } from 'node:crypto';
import { CURRENCY_EXPONENT_V1 } from '../../m0-004/ts/authorization.ts';
import { parseMinor } from '../../m0-004/ts/allocation.ts';
import type { FixtureCase, FixtureContext, FixtureProjection } from './fixture.ts';

type Json = Record<string, unknown>;
const app = 'gid://shopify/App/429028933633';
const shop = 'gid://shopify/Shop/105501393179';
const installation = 'gid://shopify/AppInstallation/1054356963611';
const domain = 'insignia-rewrite-dev.myshopify.com';
const namespace = 'app--429028933633';

function object(value: unknown, label: string): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: object required`);
  return value as Json;
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}: string required`);
  return value;
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}: array required`);
  return value;
}
function metafield(value: unknown, key: string, owner: string): string {
  const m = object(value, key);
  if (m.namespace !== namespace || m.key !== key || object(m.owner, `${key}.owner`).__typename !== owner) {
    throw new Error(`${key}: different owner/namespace`);
  }
  return text(m.value, `${key}.value`);
}
function dateDay(date: string): number {
  if (!/^20\d\d-\d\d-\d\d$/.test(date) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Error('shop-local day invalid');
  }
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}
function numericVariant(id: unknown): string {
  const match = /^gid:\/\/shopify\/ProductVariant\/([1-9][0-9]{0,19})$/.exec(text(id, 'variant ID'));
  if (!match) throw new Error('numeric real variant GID required');
  return match[0];
}

export interface FixtureIds { productA: string; productB: string }
export interface CurrentReads {
  /** Raw result of the pinned, authenticated read-fixture.graphql query. */
  admin: Json;
  /** Raw Function inputs captured from the same plain cart before signing. */
  transform: Json;
  validation: Json;
  transformInputBytes: number;
  validationInputBytes: number;
}

export interface LineAssignment {
  cartLineId: string;
  variantGid: string;
  quantity: number;
  fixtureRole: string;
  memberIndex: number | null;
}

/** Binds current authenticated Admin and actual Function input reads to one signing decision. */
export function bindCurrentFixture(kind: FixtureCase, ids: FixtureIds,
  reads: CurrentReads, keyId: number, expectedPublicHex: string,
  quoteHex: string, setHex: string): { context: FixtureContext;
  projection: FixtureProjection; assignments: LineAssignment[]; readDigest: string } {
  const a = reads.admin;
  const s = object(a.shop, 'shop');
  const install = object(a.currentAppInstallation, 'installation');
  if (s.id !== shop || s.myshopifyDomain !== domain || install.id !== installation ||
      object(install.app, 'app').id !== app ||
      object(install.app, 'app').apiKey !== '1443cf6d03d39edae7c101a943c5c684') {
    throw new Error('current app/shop/installation mismatch');
  }
  const currency = text(s.currencyCode, 'currency');
  if (CURRENCY_EXPONENT_V1[currency] !== 2) throw new Error('current currency is not supported two-decimal');
  text(s.ianaTimezone, 'timezone');
  const products = array(a.nodes, 'products');
  if (products.length !== 2) throw new Error('exactly two fixture products required');
  const normalized = products.map((p, i) => {
    const obj = object(p, `product ${i}`);
    if (obj.id !== (i === 0 ? ids.productA : ids.productB) ||
        !text(obj.title, 'title').startsWith('M0-014 ') ||
        !array(obj.tags, 'tags').includes('m0-014') || obj.status !== 'ACTIVE') {
      throw new Error(`product ${i}: not the active owned fixture`);
    }
    return obj;
  });
  const productA = normalized[0]!, productB = normalized[1]!;
  const av = array(object(productA.variants, 'A variants').nodes, 'A variant nodes').map(x => object(x, 'A variant'));
  const bv = array(object(productB.variants, 'B variants').nodes, 'B variant nodes').map(x => object(x, 'B variant'));
  if (av.length !== 2 || bv.length !== 1 || [...av, ...bv].some(v => v.price !== '20.00')) {
    throw new Error('exactly 2+1 variants priced 20.00 required');
  }
  const small = av.find(v => v.title === 'Small');
  const large = av.find(v => v.title === 'Large');
  if (!small || !large || av.filter(v => v.title === 'Small').length !== 1 ||
      av.filter(v => v.title === 'Large').length !== 1) throw new Error('Small/Large variant titles missing');
  const smallVariantGid = numericVariant(small.id);
  const largeVariantGid = numericVariant(large.id);
  if (smallVariantGid === largeVariantGid ||
      numericVariant(bv[0]!.id) === smallVariantGid || numericVariant(bv[0]!.id) === largeVariantGid) {
    throw new Error('variant identities overlap');
  }
  const config = JSON.parse(metafield(s.publicConfig, 'm0_007_public_config', 'Shop')) as Json;
  if (Buffer.byteLength(text(object(s.publicConfig, 'shop config').value, 'shop config value')) > 1_024) {
    throw new Error('public Function configuration exceeds pinned guard');
  }
  const generationHex = text(config.generationHex, 'generation');
  const epoch = config.epoch;
  if (!/^[0-9a-f]{32}$/.test(generationHex) || !Number.isSafeInteger(epoch) ||
      config.maxBuckets !== 32 || config.maxPhysicalQuantity !== 10_000 || config.allowNoMarket !== false) {
    throw new Error('unexpected Function public configuration');
  }
  const keys = array(config.keys, 'keys').map(k => object(k, 'key'));
  const selected = keys.filter(k => k.id === keyId);
  if (selected.length !== 1 || selected[0]!.publicHex !== expectedPublicHex ||
      selected[0]!.revoked !== false) throw new Error('signing key missing or mismatched');
  for (const [product, requirement] of [[productA, 'optional'], [productB, 'required']] as const) {
    const value = `${generationHex}:${epoch}:${requirement}`;
    if (metafield(product.registration, 'm0_007_registration', 'Product') !==
        `${generationHex}:${epoch}:ready` ||
        metafield(product.policy, 'm0_007_policy', 'Product') !== value) {
      throw new Error(`fixture ${requirement} policy not ready`);
    }
  }
  let country = '', marketId = '', shopLocalDate = '';
  const expectedCount = kind === 'small' ? 3 : 200;
  const expectedQuantity = kind === 'small' ? 4 : 200;
  const expectedVariant = kind === 'small' ? smallVariantGid : largeVariantGid;
  // Fixture roles come from distinct, observed line properties in both
  // Function inputs. Target-local CartLine IDs cannot be correlated across
  // Transform and Validation, and equal quantities cannot identify intent.
  const roleMember = new Map<string, { quantity: number; memberIndex: number | null }>();
  if (kind === 'small') {
    roleMember.set('m0-014-small-custom-0', { quantity: 1, memberIndex: 0 });
    roleMember.set('m0-014-small-custom-1', { quantity: 2, memberIndex: 1 });
    roleMember.set('m0-014-small-ordinary-0', { quantity: 1, memberIndex: null });
  } else {
    const customized = kind === 'stress10' ? 10 : kind === 'stress32' ? 32 : 33;
    for (let i = 0; i < customized; i++) roleMember.set(`m0-014-large-customized-${i + 1}`,
      { quantity: 1, memberIndex: i });
    for (let i = 0; i < 200 - customized; i++) roleMember.set(`m0-014-large-ordinary-${i + 1}`,
      { quantity: 1, memberIndex: null });
  }
  const captures: LineAssignment[][] = [];
  for (const [label, input] of [['transform', reads.transform], ['validation', reads.validation]] as const) {
    const loc = object(input.localization, `${label}.localization`);
    const localCountry = text(object(loc.country, 'country').isoCode, 'country code');
    const market = text(object(loc.market, 'market').id, 'market GID');
    const match = /^gid:\/\/shopify\/Market\/([1-9][0-9]*)$/.exec(market);
    const localDate = text(object(object(input.shop, 'input shop').localTime, 'localTime').date, 'local date');
    if (!match || !/^[A-Z]{2}$/.test(localCountry)) throw new Error(`${label}: presentment context invalid`);
    if (country && (country !== localCountry || marketId !== match[1] || shopLocalDate !== localDate)) {
      throw new Error('Function presentment contexts differ');
    }
    country = localCountry; marketId = match[1]!; shopLocalDate = localDate;
    const projectedConfig = text(object(object(input.shop, 'input shop').publicConfig,
      'input public config').value, 'input public config value');
    if (projectedConfig !== text(object(s.publicConfig, 'shop config').value, 'shop config value')) {
      throw new Error('Function public config projection differs from Admin readback');
    }
    const cart = object(input.cart, `${label}.cart`);
    if (cart.quote !== null) throw new Error('signing projection requires a plain cart without an envelope');
    const lines = array(cart.lines, `${label}.lines`).map(x => object(x, 'line'));
    if (lines.length !== expectedCount || lines.some(x => x.member !== null)) {
      throw new Error(`${label}: actual line count or carrier mismatch`);
    }
    let totalQuantity = 0;
    const actualLines: LineAssignment[] = [];
    const seenIds = new Set<string>();
    const seenRoles = new Set<string>();
    for (const line of lines) {
      const lineId = text(line.id, 'CartLine ID');
      const suffix = lineId.startsWith('gid://shopify/CartLine/')
        ? lineId.slice('gid://shopify/CartLine/'.length) : '';
      // Native Validation uses zero-based indices while Transform uses UUIDs.
      // The IDs address target-local operations; they are not quote members.
      const numeric = /^(0|[1-9][0-9]{0,19})$/.test(suffix);
      const uuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(suffix);
      if (!numeric && !uuid) throw new Error(`${label}: CartLine ID outside compiled grammar`);
      if (seenIds.has(lineId)) throw new Error(`${label}: duplicate CartLine ID`);
      seenIds.add(lineId);
      const merchandise = object(line.merchandise, 'merchandise');
      if (merchandise.id !== expectedVariant ||
          object(merchandise.product, 'product').id !== ids.productA ||
          line.sellingPlanAllocation !== null ||
          !Number.isSafeInteger(line.quantity) || (line.quantity as number) < 1) {
        throw new Error(`${label}: unsupported cart line`);
      }
      const q = line.quantity as number;
      const role = text(object(line.fixtureRole, `${label}.fixtureRole`).value,
        `${label}.fixtureRole.value`);
      const intended = roleMember.get(role);
      if (!intended || intended.quantity !== q || seenRoles.has(role)) {
        throw new Error(`${label}: fixture role/quantity missing, duplicated or inconsistent`);
      }
      seenRoles.add(role);
      totalQuantity += q;
      actualLines.push({ cartLineId: lineId, variantGid: expectedVariant,
        quantity: q, fixtureRole: role, memberIndex: intended.memberIndex });
      const projectedPolicy = object(merchandise.product, 'product');
      if (text(object(projectedPolicy.policy, 'policy').value, 'policy') !==
          `${generationHex}:${epoch}:optional` ||
          text(object(projectedPolicy.registration, 'registration').value, 'registration') !==
          `${generationHex}:${epoch}:ready`) throw new Error(`${label}: product policy projection differs`);
      if (label === 'validation') {
        const subtotal = object(object(line.cost, 'cost').subtotalAmount, 'subtotal');
        if (subtotal.currencyCode !== currency ||
            parseMinor(text(subtotal.amount, 'subtotal amount'), 2) !== BigInt(q * 2_000)) {
          throw new Error('plain fixture price differs before signing');
        }
      } else if (object(object(line.cost, 'cost').amountPerQuantity, 'amountPerQuantity').currencyCode !== currency) {
        throw new Error('transform currency differs');
      }
    }
    if (totalQuantity !== expectedQuantity || seenRoles.size !== roleMember.size) {
      throw new Error(`${label}: physical quantity or fixture role set mismatch`);
    }
    captures.push(actualLines);
  }
  // Compare by independently projected role, not CartLine ID or array position.
  const economicRows = (lines: LineAssignment[]) => lines.map(
    ({ variantGid, quantity, fixtureRole, memberIndex }) =>
      ({ variantGid, quantity, fixtureRole, memberIndex }))
    .sort((left, right) => left.fixtureRole.localeCompare(right.fixtureRole));
  if (JSON.stringify(economicRows(captures[0]!)) !== JSON.stringify(economicRows(captures[1]!))) {
    throw new Error('Transform and Validation fixture role economics differ');
  }
  const assignments = captures[0]!;
  const day = dateDay(shopLocalDate);
  const key = selected[0]!;
  if (typeof key.firstDay !== 'number' || typeof key.lastDay !== 'number' ||
      key.firstDay > day || key.lastDay < day + 2) throw new Error('key validity does not cover offer');
  const plannedBuckets = kind === 'small' ? 2 : kind === 'stress10' ? 10 : kind === 'stress32' ? 32 : 33;
  const ordinaryLines = expectedCount - plannedBuckets;
  const ordinaryPhysicalQuantity = expectedQuantity - (kind === 'small' ? 3 : plannedBuckets);
  const upper = (bytes: number) => bytes + 2_048 + plannedBuckets * 128;
  if (![reads.transformInputBytes, reads.validationInputBytes].every(x => Number.isSafeInteger(x) && x > 0)) {
    throw new Error('actual captured Function input byte counts required');
  }
  const context: FixtureContext = { appGid: app, shopGid: shop, installationGid: installation,
    storeDomain: domain, smallVariantGid, largeVariantGid, currency, country, marketId,
    shopLocalDate, keyId, generationHex, epoch: epoch as number, quoteHex, setHex };
  const projection: FixtureProjection = { ordinaryLines, ordinaryPhysicalQuantity,
    ordinaryUnitMinor: '2000', unresolvedManagedLines: 0,
    transformInputUpperBytes: upper(reads.transformInputBytes),
    validationInputUpperBytes: upper(reads.validationInputBytes) };
  const readDigest = createHash('sha256').update(JSON.stringify({ admin: a, transform: reads.transform,
    validation: reads.validation })).digest('hex');
  return { context, projection, assignments, readDigest };
}
