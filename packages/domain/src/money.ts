// Pure exact-money primitive from the reviewed M0-004 allocation model.
// This is not a buyer authorization issuer or a complete pricing engine.
export const U64_MAX = (1n << 64n) - 1n;

function scaleFor(exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 3) {
    throw new Error('unsupported currency exponent');
  }
  return 10n ** BigInt(exponent);
}

export function parseMinor(lexical: string, exponent: number): bigint {
  const scale = scaleFor(exponent);
  if (typeof lexical !== 'string' || lexical.length > 25 || !/^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.test(lexical)) {
    throw new Error('invalid nonnegative lexical decimal');
  }
  const [whole, fraction = ''] = lexical.split('.');
  if (whole === undefined || fraction.length > exponent) {
    throw new Error('fraction exceeds currency exponent');
  }
  const amount = BigInt(whole) * scale + BigInt(fraction.slice(0, exponent).padEnd(exponent, '0') || '0');
  if (amount > U64_MAX) throw new Error('minor amount overflows u64');
  return amount;
}

export function checkedMinor(amount: bigint): bigint {
  if (amount < 0n || amount > U64_MAX) throw new Error('minor amount out of u64 range');
  return amount;
}

export function parseSignedMinor(lexical: string, exponent: number): bigint {
  if (typeof lexical !== 'string' || lexical.length > 26 || !/^-?(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(lexical)) {
    throw new Error('invalid signed lexical decimal');
  }
  const negative = lexical.startsWith('-');
  const magnitude = parseMinor(negative ? lexical.slice(1) : lexical, exponent);
  return negative ? -magnitude : magnitude;
}

export interface DecimalRational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export function parsePositiveDecimalRational(lexical: string): DecimalRational {
  if (typeof lexical !== 'string' || lexical.length > 64 || !/^(0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(lexical)) {
    throw new Error('invalid positive decimal rate');
  }
  const [whole, fraction = ''] = lexical.split('.');
  if (whole === undefined) throw new Error('invalid positive decimal rate');
  const numerator = BigInt(whole + fraction);
  if (numerator === 0n) throw new Error('FX rate must be positive');
  return { numerator, denominator: 10n ** BigInt(fraction.length) };
}

export function roundHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('rounding denominator must be positive');
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const quotient = magnitude / denominator;
  const remainder = magnitude % denominator;
  const rounded =
    quotient + (2n * remainder > denominator || (2n * remainder === denominator && quotient % 2n === 1n) ? 1n : 0n);
  return negative ? -rounded : rounded;
}

export function formatMinor(amount: bigint, exponent: number): string {
  const scale = scaleFor(exponent);
  if (typeof amount !== 'bigint' || amount < 0n || amount > U64_MAX) {
    throw new Error('minor amount out of u64 range');
  }
  if (exponent === 0) return amount.toString();
  return `${amount / scale}.${(amount % scale).toString().padStart(exponent, '0')}`;
}
