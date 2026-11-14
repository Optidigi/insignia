import {
  type MerchantCustomerWordingOverlays,
  type MerchantGuidance,
  type MerchantPreferencesCommand,
  MerchantPreferencesCommandSchema,
  type MerchantPreferencesView,
  MerchantPreferencesViewSchema,
} from '@insignia/contracts';
import { authenticatedJson, isShopifyBusy } from './admin-request.ts';

type Request = (path: string, init?: RequestInit) => Promise<unknown>;
type Journal = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Pending = { key: string; command: MerchantPreferencesCommand };
const endpoint = '/api/admin/preferences';
const journalKey = (shop: string, section: 'guidance' | 'wording') =>
  `insignia:pending-preferences:v1:${shop}:${section}`;
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export class MerchantPreferencesConflictError extends Error {}

/** Holds only an unacknowledged mutation intent locally, never authoritative preferences. */
export function createMerchantPreferencesClient(
  request: Request = authenticatedJson,
  journal: Journal | null = browserJournal(),
  freshKey: () => string = () => crypto.randomUUID(),
) {
  let current: MerchantPreferencesView | null = null;
  const pending: Partial<Record<'guidance' | 'wording', Pending>> = {};
  let serial: Promise<unknown> = Promise.resolve();
  function queued<T>(work: () => Promise<T>): Promise<T> {
    const result = serial.then(work, work);
    serial = result.catch(() => undefined);
    return result;
  }
  function clear(section: 'guidance' | 'wording') {
    if (current) journal?.removeItem(journalKey(current.shop, section));
    delete pending[section];
  }
  function restore(view: MerchantPreferencesView) {
    for (const section of ['guidance', 'wording'] as const) {
      const raw = journal?.getItem(journalKey(view.shop, section));
      if (!raw) continue;
      const value: unknown = JSON.parse(raw);
      if (!isObject(value) || typeof value.key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value.key))
        throw new Error('Invalid pending store preference command');
      const command = MerchantPreferencesCommandSchema.parse(value.command);
      if (command.action !== section) throw new Error('Invalid pending store preference section');
      if (command.authority !== view.authority) {
        journal?.removeItem(journalKey(view.shop, section));
        throw new Error('Store preference authority changed; reopen the page');
      }
      pending[section] = { key: value.key, command };
    }
  }
  async function send(operation: Pending): Promise<MerchantPreferencesView> {
    const section = operation.command.action;
    try {
      const value = await request(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operation.key },
        body: JSON.stringify(operation.command),
      });
      if (!isObject(value) || value.kind !== 'saved') throw new Error('Invalid store preference save response');
      const saved = MerchantPreferencesViewSchema.parse(value.preferences);
      if (!current || saved.shop !== current.shop || saved.authority !== current.authority)
        throw new Error('Store preference authority changed');
      current = saved;
      clear(section);
      return saved;
    } catch (error) {
      // Shopify was busy: nothing happened, so keep the journal and retry the same intent later.
      if (isShopifyBusy(error)) throw error;
      const status = isObject(error) ? error.status : undefined;
      if (status === 400 || status === 409 || status === 422) clear(section);
      if (status === 401 || status === 403) {
        clear('guidance');
        clear('wording');
        current = null;
      }
      if (status === 409)
        throw new MerchantPreferencesConflictError('Store preferences changed; reload before saving again');
      throw error;
    }
  }
  async function load(): Promise<MerchantPreferencesView> {
    const view = MerchantPreferencesViewSchema.parse(await request(endpoint));
    if (current && (view.shop !== current.shop || view.authority !== current.authority)) {
      clear('guidance');
      clear('wording');
    }
    current = view;
    restore(view);
    // Resume only the exact original saved intent, with its original key and authority.
    // A rejected CAS has a known outcome; read the latest store state afterwards.
    for (const section of ['guidance', 'wording'] as const) {
      const operation = pending[section];
      if (!operation) continue;
      try {
        await send(operation);
      } catch (error) {
        if (!(error instanceof MerchantPreferencesConflictError)) throw error;
      }
    }
    return (current = MerchantPreferencesViewSchema.parse(await request(endpoint)));
  }
  async function save(
    section: 'guidance' | 'wording',
    value: MerchantGuidance | MerchantCustomerWordingOverlays,
    observedVersion: string | undefined,
  ): Promise<MerchantPreferencesView> {
    if (!current) await load();
    if (!current) throw new Error('Store preferences not loaded');
    const prior = pending[section];
    if (prior) {
      await send(prior);
      // The original receipt is now known; a new explicit save follows that version.
      observedVersion = section === 'guidance' ? current?.guidanceVersion : current?.wordingVersion;
    }
    const command = MerchantPreferencesCommandSchema.parse(
      section === 'guidance'
        ? {
            action: section,
            authority: current.authority,
            expectedVersion: observedVersion ?? current.guidanceVersion,
            guidance: value,
          }
        : {
            action: section,
            authority: current.authority,
            expectedVersion: observedVersion ?? current.wordingVersion,
            overlays: value,
          },
    );
    const operation = { key: freshKey(), command };
    // Persist before dispatch. If custody is unavailable, do not create an unresumable write.
    if (!journal) throw new Error('Pending store preference custody unavailable');
    journal.setItem(journalKey(current.shop, section), JSON.stringify(operation));
    pending[section] = operation;
    return send(operation);
  }
  return {
    read: () => queued(load),
    saveGuidance: (guidance: MerchantGuidance) => {
      const observedVersion = current?.guidanceVersion;
      return queued(() => save('guidance', guidance, observedVersion));
    },
    saveWording: (overlays: MerchantCustomerWordingOverlays) => {
      const observedVersion = current?.wordingVersion;
      return queued(() => save('wording', overlays, observedVersion));
    },
  };
}
function browserJournal(): Journal | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
