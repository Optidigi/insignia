// Pure exact-money primitive from the reviewed M0-004 allocation model.
// This is not a buyer authorization issuer or a complete pricing engine.
const U64_MAX = (1n << 64n) - 1n;

function scaleFor(exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 3) {
    throw new Error('unsupported currency exponent');
  }
  return 10n ** BigInt(exponent);
}

export function parseMinor(lexical: string, exponent: number): bigint {
  const scale = scaleFor(exponent);
  if (typeof lexical !== 'string' || !/^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.test(lexical)) {
    throw new Error('invalid nonnegative lexical decimal');
  }
  const [whole, fraction = ''] = lexical.split('.');
  if (whole === undefined || /[1-9]/.test(fraction.slice(exponent))) {
    throw new Error('fraction exceeds currency exponent');
  }
  const amount = BigInt(whole) * scale + BigInt(fraction.slice(0, exponent).padEnd(exponent, '0') || '0');
  if (amount > U64_MAX) throw new Error('minor amount overflows u64');
  return amount;
}

export function formatMinor(amount: bigint, exponent: number): string {
  const scale = scaleFor(exponent);
  if (typeof amount !== 'bigint' || amount < 0n || amount > U64_MAX) {
    throw new Error('minor amount out of u64 range');
  }
  if (exponent === 0) return amount.toString();
  return `${amount / scale}.${(amount % scale).toString().padStart(exponent, '0')}`;
}
