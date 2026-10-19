import type { Stats } from 'node:fs';
export interface Binding {
  experiment: string;
  era: string;
  appId: string;
  providerShopId: string;
  providerShopDomain: string;
  appInstallationId: string;
  capabilityLabel: string;
}
export interface Mapping {
  version: 1;
  binding: Binding;
  capability: string;
  acceptUntil: number;
  eraseBy: number;
  maxArrivals: number;
  maxBytes: number;
  bodyDeadlineMs: number;
}
export interface LifecycleGuard {
  target: string;
  path: string;
}
export interface Ownership {
  identity: Stats;
  lock: Stats;
  value: string;
}
export interface Receipt {
  receipt: number;
  at: number;
  capabilityLabel: string;
  binding: Binding;
  acceptedVerifierSucceeded: boolean;
  signedShopMatches: boolean;
  topicEligible: boolean;
  rawBody: string;
  headers: Record<string, string | string[]>;
}
export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw Error('REFUSED');
  return value as Record<string, unknown>;
}
export function json(value: string): unknown {
  return JSON.parse(value);
}
export function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw Error('REFUSED');
  return value;
}
export function errorCode(error: unknown): unknown {
  return error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined;
}
export function receipt(value: unknown): Receipt {
  const raw = record(value),
    binding = record(raw.binding),
    headers = record(raw.headers);
  for (const key of ['receipt', 'at'])
    if (typeof raw[key] !== 'number' || !Number.isSafeInteger(raw[key])) throw Error('REFUSED');
  for (const key of ['capabilityLabel', 'rawBody']) if (typeof raw[key] !== 'string') throw Error('REFUSED');
  for (const key of ['acceptedVerifierSucceeded', 'signedShopMatches', 'topicEligible'])
    if (typeof raw[key] !== 'boolean') throw Error('REFUSED');
  for (const key of [
    'experiment',
    'era',
    'appId',
    'providerShopId',
    'providerShopDomain',
    'appInstallationId',
    'capabilityLabel',
  ])
    if (typeof binding[key] !== 'string') throw Error('REFUSED');
  for (const value of Object.values(headers))
    if (
      typeof value !== 'string' &&
      (!Array.isArray(value) || !value.every((entry: unknown) => typeof entry === 'string'))
    )
      throw Error('REFUSED');
  return raw as Receipt & Record<string, unknown>;
}
