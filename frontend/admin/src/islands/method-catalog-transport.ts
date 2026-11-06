import {
  type MethodConfiguration,
  MethodConfigurationSchema,
  type VersionedMethodConfiguration,
  VersionedMethodConfigurationSchema,
} from '@insignia/contracts';
import { z } from 'zod';
import { authenticatedJson } from '../shared/admin-request.ts';

export interface MethodJournalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
const version = z.string().regex(/^[1-9][0-9]{0,17}$/);
const mutationSchema = z.strictObject({
  id: z.uuid(),
  key: z.uuid(),
  command: z.discriminatedUnion('method', [
    z.strictObject({ method: z.literal('POST'), body: z.strictObject({ configuration: MethodConfigurationSchema }) }),
    z.strictObject({
      method: z.literal('PUT'),
      body: z.strictObject({ configuration: MethodConfigurationSchema, version }),
    }),
    z.strictObject({ method: z.literal('DELETE'), body: z.strictObject({ version }) }),
  ]),
});
const journalSchema = z.strictObject({
  desired: z.array(MethodConfigurationSchema).max(100),
  operations: z.array(mutationSchema).max(100),
  expiresAt: z.number(),
});
type RequestPort = (path: string, init?: RequestInit) => Promise<unknown>;

/** The journal preserves exact command identities through lost responses and reloads. */
export function createMethodCatalogTransport(input: {
  records: readonly VersionedMethodConfiguration[];
  shop: string;
  authority: string;
  currency: 'USD' | 'EUR';
  storage: MethodJournalStorage;
  request?: RequestPort;
  now?: () => number;
}) {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(input.shop) || !/^[a-f0-9]{64}$/.test(input.authority))
    throw new Error('Method authority unavailable');
  const request = input.request ?? authenticatedJson;
  const now = input.now ?? Date.now;
  const storageKey = `insignia:method-write:v1:${input.shop}:${input.authority}`;
  const records = new Map(input.records.map((record) => [record.configuration.id, record]));
  let busy = false;
  function pending() {
    const stored = input.storage.getItem(storageKey);
    if (stored === null) return null;
    const value = journalSchema.parse(JSON.parse(stored));
    if (value.expiresAt <= now())
      throw new Error('An unresolved Method write expired. Reconcile it before making another change.');
    return value;
  }
  async function apply(journal: z.infer<typeof journalSchema>) {
    for (const operation of journal.operations) {
      const { method, body } = operation.command;
      let result: unknown;
      try {
        result = await request(`/api/admin/methods${method === 'POST' ? '' : `/${operation.id}`}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': operation.key,
            'X-Insignia-Method-Authority': input.authority,
            'X-Insignia-Method-Currency': input.currency,
          },
          body: JSON.stringify(body),
        });
      } catch (error) {
        const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
        if ([401, 403, 409, 422].includes(Number(status))) input.storage.removeItem(storageKey);
        throw error;
      }
      if (method === 'DELETE') {
        if (!result || typeof result !== 'object' || !('kind' in result) || result.kind !== 'deleted')
          throw new Error('Invalid Method deletion receipt');
        records.delete(operation.id);
      } else {
        const parsed = z
          .strictObject({ kind: z.enum(['created', 'saved']), method: VersionedMethodConfigurationSchema })
          .parse(result);
        if (parsed.method.configuration.id !== operation.id) throw new Error('Method receipt identity mismatch');
        records.set(operation.id, parsed.method);
      }
    }
    input.storage.removeItem(storageKey);
  }
  return {
    currentRecords() {
      return [...records.values()];
    },
    async resume() {
      const journal = pending();
      if (journal) await apply(journal);
    },
    async persist(values: MethodConfiguration[]) {
      if (busy) throw new Error('A Method write is still pending');
      busy = true;
      try {
        const desired = MethodConfigurationSchema.array().max(100).parse(values);
        const previous = pending();
        if (previous) {
          if (JSON.stringify(previous.desired) !== JSON.stringify(desired))
            throw new Error('Resolve the original Method write before changing its request');
          await apply(previous);
          return;
        }
        const operations: z.infer<typeof mutationSchema>[] = [];
        const ids = new Set(desired.map((value) => value.id));
        if (ids.size !== desired.length) throw new Error('Duplicate Method identity');
        for (const configuration of desired) {
          const record = records.get(configuration.id);
          if (
            record &&
            JSON.stringify(record.configuration) === JSON.stringify(configuration) &&
            (configuration.pricing !== 'fixed' || record.currency === input.currency)
          )
            continue;
          operations.push({
            id: configuration.id,
            key: crypto.randomUUID(),
            command: record
              ? { method: 'PUT', body: { configuration, version: record.version } }
              : { method: 'POST', body: { configuration } },
          });
        }
        for (const [id, record] of records)
          if (!ids.has(id))
            operations.push({
              id,
              key: crypto.randomUUID(),
              command: { method: 'DELETE', body: { version: record.version } },
            });
        if (!operations.length) return;
        const journal = { desired, operations, expiresAt: now() + 30 * 60 * 1000 };
        input.storage.setItem(storageKey, JSON.stringify(journal));
        await apply(journal);
      } finally {
        busy = false;
      }
    },
  };
}

/** API IDs are canonical decimals; selected picker identities use Shopify GIDs. */
export function methodConfigurationForPicker(configuration: MethodConfiguration): MethodConfiguration {
  return {
    ...configuration,
    productIds: configuration.productIds.map((id) =>
      id.startsWith('gid://shopify/Product/') ? id : `gid://shopify/Product/${id}`,
    ),
  };
}
