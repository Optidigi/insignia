import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { CartProperty } from '../src/cart.ts';

export function required<T>(value: T | null | undefined): T {
  assert(value !== null && value !== undefined, 'Missing test fixture or observed value');
  return value;
}
export function serverPort(server: Pick<Server, 'address'> | null): number {
  const address = required(server).address();
  assert(address && typeof address !== 'string', 'Expected listening TCP server');
  return address.port;
}
export function requestUrl(input: Parameters<typeof fetch>[0]): string {
  return input instanceof Request ? input.url : String(input);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function record(value: unknown): Record<string, unknown> {
  assert(isRecord(value));
  return value;
}
export function jsonRecord(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  return record(value);
}
export type AjaxItem = {
  key: string;
  variant_id: number | string;
  quantity: number;
  properties: Record<string, CartProperty>;
  product_id?: number | string;
};
export type AjaxBody = {
  items?: { id: string | number; quantity: number; properties: Record<string, string> }[];
  updates?: Record<string, number>;
  attributes?: Record<string, string>;
};
export function ajaxBody(value: unknown): AjaxBody {
  const body = record(value);
  const items = body.items === undefined ? [] : body.items;
  assert(Array.isArray(items));
  const decoded = items.map((item: unknown) => {
    const entry = record(item);
    assert(typeof entry.id === 'string' || typeof entry.id === 'number');
    assert(typeof entry.quantity === 'number');
    const properties = record(entry.properties);
    const checked: Record<string, string> = {};
    for (const [key, value] of Object.entries(properties)) {
      assert(typeof value === 'string');
      checked[key] = value;
    }
    return { id: entry.id, quantity: entry.quantity, properties: checked };
  });
  const result: AjaxBody = {};
  if (body.items !== undefined) result.items = decoded;
  if (body.updates !== undefined) {
    result.updates = {};
    for (const [key, value] of Object.entries(record(body.updates))) {
      assert(typeof value === 'number');
      result.updates[key] = value;
    }
  }
  if (body.attributes !== undefined) {
    result.attributes = {};
    for (const [key, value] of Object.entries(record(body.attributes))) {
      assert(typeof value === 'string');
      result.attributes[key] = value;
    }
  }
  return result;
}
export function fetchBody(init: RequestInit): AjaxBody {
  assert(init.body === undefined || typeof init.body === 'string');
  return ajaxBody(init.body ? JSON.parse(init.body) : {});
}
export function text(value: unknown): string {
  assert(typeof value === 'string');
  return value;
}
