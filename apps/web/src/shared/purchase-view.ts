export type { PurchaseGroup, PurchaseView } from '@insignia/contracts';
export function exactPurchaseMoney(minor: string, exponent: number, currency: string): string {
  const digits = minor.padStart(exponent + 1, '0');
  return `${currency} ${exponent ? `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}` : digits}`;
}
