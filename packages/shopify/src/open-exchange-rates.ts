import { createHash } from 'node:crypto';

/** Open Exchange Rates Developer source. No cache, cross-rate, or implicit fallback. */
const ENDPOINT = 'https://openexchangerates.org/api/latest.json';
const CURRENCY = /^[A-Z]{3}$/;
export type OXRReason =
  | 'auth'
  | 'rate_limited'
  | 'network'
  | 'provider'
  | 'redirect'
  | 'malformed'
  | 'missing_pair'
  | 'wrong_base'
  | 'stale'
  | 'configuration';
export class OpenExchangeRatesError extends Error {
  readonly reason: OXRReason;
  constructor(reason: OXRReason) {
    super(`Open Exchange Rates unavailable: ${reason}`);
    this.name = 'OpenExchangeRatesError';
    this.reason = reason;
  }
}
type Fetcher = (
  url: string,
  init: { method: 'GET'; headers: { accept: string }; redirect: 'manual'; signal: AbortSignal },
) => Promise<Response>;
export interface OXROptions {
  appId: string;
  fetcher: Fetcher;
  clock: () => Date;
  maxAgeMs: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
}
export interface OXRSnapshot {
  readonly version: 'm4-customization-fx-v1';
  readonly shopId: string;
  readonly installationGeneration: string;
  readonly shopCurrency: string;
  readonly presentmentCurrency: string;
  readonly rateDecimal: string;
  readonly source: string;
  readonly sourceVersion: string;
  readonly provenance: string;
  readonly observedAt: string;
  readonly effectiveAt: string;
  readonly expiresAt: string;
}
class JsonNumber {
  readonly text: string;
  constructor(text: string) {
    this.text = text;
  }
}
/** Small bounded JSON reader retaining numeric lexemes and rejecting duplicate object keys. */
function parseJson(source: string): unknown {
  let i = 0;
  const ws = () => {
    while (/[\x20\t\r\n]/.test(source[i] ?? '!')) i++;
  };
  const value = (depth: number): unknown => {
    if (depth > 8) throw Error('depth');
    ws();
    const c = source[i];
    if (c === '"') {
      const start = i++;
      while (i < source.length) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i++] === '"') return JSON.parse(source.slice(start, i)) as string;
      }
      throw Error('string');
    }
    if (c === '{') {
      i++;
      const obj: Record<string, unknown> = Object.create(null);
      ws();
      if (source[i] === '}') {
        i++;
        return obj;
      }
      for (;;) {
        const key = value(depth + 1);
        if (typeof key !== 'string' || Object.hasOwn(obj, key)) throw Error('key');
        ws();
        if (source[i++] !== ':') throw Error('colon');
        obj[key] = value(depth + 1);
        ws();
        const next = source[i++];
        if (next === '}') return obj;
        if (next !== ',') throw Error('object');
      }
    }
    if (c === '[') {
      i++;
      const arr: unknown[] = [];
      ws();
      if (source[i] === ']') {
        i++;
        return arr;
      }
      for (;;) {
        arr.push(value(depth + 1));
        ws();
        const next = source[i++];
        if (next === ']') return arr;
        if (next !== ',') throw Error('array');
      }
    }
    for (const [literal, answer] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (source.startsWith(literal, i)) {
        i += literal.length;
        return answer;
      }
    }
    const number = source.slice(i).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (number) {
      i += number[0].length;
      return new JsonNumber(number[0]);
    }
    throw Error('value');
  };
  const result = value(0);
  ws();
  if (i !== source.length) throw Error('trailing');
  return result;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof JsonNumber) throw Error('object');
  return value as Record<string, unknown>;
}
function exactRate(value: unknown): string {
  if (!(value instanceof JsonNumber) || value.text.length > 64) throw Error('rate');
  const m = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(value.text);
  if (!m) throw Error('rate');
  const power = m[3] === undefined ? 0 : Number(m[3]);
  if (!Number.isSafeInteger(power) || Math.abs(power) > 64) throw Error('rate');
  const wholeDigits = m[1];
  if (wholeDigits === undefined) throw Error('rate');
  const fraction = m[2] ?? '';
  const digits = wholeDigits + fraction;
  const position = wholeDigits.length + power;
  let expanded: string;
  if (position <= 0) expanded = `0.${'0'.repeat(-position)}${digits}`;
  else if (position >= digits.length) expanded = digits + '0'.repeat(position - digits.length);
  else expanded = `${digits.slice(0, position)}.${digits.slice(position)}`;
  const [whole, decimal = ''] = expanded.split('.');
  if (whole === undefined) throw Error('rate');
  const normalized = `${BigInt(whole).toString()}${decimal ? `.${decimal}` : ''}`;
  if (normalized.length > 64 || decimal.length > 18 || !/[1-9]/.test(normalized)) throw Error('rate');
  return normalized;
}
async function boundedBody(response: Response, max: number): Promise<string> {
  const length = response.headers.get('content-length');
  if (length && Number(length) > max) throw Error('body');
  if (!response.body) throw Error('body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.length;
      if (bytes > max) throw Error('body');
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}
export class OpenExchangeRatesProvider {
  private readonly options: OXROptions;
  constructor(options: OXROptions) {
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(options.appId) ||
      typeof options.fetcher !== 'function' ||
      typeof options.clock !== 'function' ||
      !Number.isSafeInteger(options.maxAgeMs) ||
      options.maxAgeMs < 1000 ||
      options.maxAgeMs > 86400000 ||
      !Number.isSafeInteger(options.timeoutMs ?? 5000) ||
      (options.timeoutMs ?? 5000) < 1 ||
      (options.timeoutMs ?? 5000) > 30000 ||
      !Number.isSafeInteger(options.maxResponseBytes ?? 65536) ||
      (options.maxResponseBytes ?? 65536) < 256 ||
      (options.maxResponseBytes ?? 65536) > 65536
    )
      throw new OpenExchangeRatesError('configuration');
    this.options = options;
  }
  async resolve(input: {
    shopId: string;
    installationGeneration: string;
    shopCurrency: string;
    presentmentCurrency: string;
  }): Promise<OXRSnapshot> {
    if (
      !input.shopId ||
      !/^[1-9][0-9]*$/.test(input.installationGeneration) ||
      !CURRENCY.test(input.shopCurrency) ||
      !CURRENCY.test(input.presentmentCurrency) ||
      input.shopCurrency === input.presentmentCurrency
    )
      throw new OpenExchangeRatesError('configuration');
    const url = new URL(ENDPOINT);
    url.searchParams.set('app_id', this.options.appId);
    url.searchParams.set('base', input.shopCurrency);
    url.searchParams.set('symbols', input.presentmentCurrency);
    url.searchParams.set('prettyprint', '0');
    if (url.protocol !== 'https:' || url.hostname !== 'openexchangerates.org' || url.pathname !== '/api/latest.json')
      throw new OpenExchangeRatesError('configuration');
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abort.abort();
          reject(new OpenExchangeRatesError('network'));
        }, this.options.timeoutMs ?? 5000);
      });
      const response = await Promise.race([
        this.options.fetcher(url.toString(), {
          method: 'GET',
          headers: { accept: 'application/json' },
          redirect: 'manual',
          signal: abort.signal,
        }),
        timeout,
      ]);
      if (response.status >= 300 && response.status < 400) throw new OpenExchangeRatesError('redirect');
      if (response.status === 401 || response.status === 403) throw new OpenExchangeRatesError('auth');
      if (response.status === 429) throw new OpenExchangeRatesError('rate_limited');
      if (response.status >= 500) throw new OpenExchangeRatesError('provider');
      if (response.status !== 200) throw new OpenExchangeRatesError('malformed');
      if (response.redirected) throw new OpenExchangeRatesError('redirect');
      if (response.url) {
        const finalUrl = new URL(response.url);
        if (finalUrl.origin !== 'https://openexchangerates.org' || finalUrl.pathname !== '/api/latest.json')
          throw new OpenExchangeRatesError('redirect');
      }
      let root: Record<string, unknown>;
      try {
        root = record(
          parseJson(await Promise.race([boundedBody(response, this.options.maxResponseBytes ?? 65536), timeout])),
        );
      } catch (error) {
        if (error instanceof OpenExchangeRatesError) throw error;
        throw new OpenExchangeRatesError('malformed');
      }
      if (root.base !== input.shopCurrency) throw new OpenExchangeRatesError('wrong_base');
      let rates: Record<string, unknown>;
      try {
        rates = record(root.rates);
      } catch {
        throw new OpenExchangeRatesError('malformed');
      }
      if (!Object.hasOwn(rates, input.presentmentCurrency)) throw new OpenExchangeRatesError('missing_pair');
      let rateDecimal: string;
      try {
        rateDecimal = exactRate(rates[input.presentmentCurrency]);
      } catch {
        throw new OpenExchangeRatesError('malformed');
      }
      const stamp = root.timestamp;
      if (!(stamp instanceof JsonNumber) || !/^[1-9][0-9]{0,10}$/.test(stamp.text))
        throw new OpenExchangeRatesError('malformed');
      const observed = this.options.clock().getTime();
      if (!Number.isFinite(observed)) throw new OpenExchangeRatesError('configuration');
      const effective = Number(stamp.text) * 1000;
      const expiry = effective + this.options.maxAgeMs;
      if (!Number.isSafeInteger(effective) || !Number.isSafeInteger(expiry))
        throw new OpenExchangeRatesError('malformed');
      if (effective > observed || observed >= expiry) throw new OpenExchangeRatesError('stale');
      return {
        version: 'm4-customization-fx-v1',
        shopId: input.shopId,
        installationGeneration: input.installationGeneration,
        shopCurrency: input.shopCurrency,
        presentmentCurrency: input.presentmentCurrency,
        rateDecimal,
        source: 'openexchangerates',
        sourceVersion: 'latest-v1',
        provenance: `oxr:latest:sha256:${createHash('sha256').update(`${stamp.text}|${input.shopCurrency}|${input.presentmentCurrency}|${rateDecimal}`).digest('hex')}`,
        observedAt: new Date(observed).toISOString(),
        effectiveAt: new Date(effective).toISOString(),
        expiresAt: new Date(expiry).toISOString(),
      };
    } catch (error) {
      if (error instanceof OpenExchangeRatesError) throw error;
      throw new OpenExchangeRatesError('network');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
