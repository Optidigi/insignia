import {
  AdminConfigViewSchema,
  MerchantDraftSchema,
  MerchantPreferencesViewSchema,
  SelectedProductSetupSchema,
  type SelectedProductSetup,
} from '@insignia/contracts';
import { z } from 'zod';
import { placementDraftEqual } from '../../examples/admin/support/placement-history.mts';

import { authenticatedJson } from '../shared/admin-request.ts';
import type { ConfigView } from '../shared/admin-view.ts';
import { configRejectionFrom } from '../shared/config-rejection.ts';
import {
  isMerchantPublicationContinuing,
  isMerchantPublicationOperatorBlocked,
} from './publication-state.ts';

// Compare persisted JSON values without depending on database object-key order.
const sameJson = (first: unknown, second: unknown) =>
  placementDraftEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
class SelectedPayloadError extends Error {}
const maxBodyBytes = 1_048_576;
function jsonBody(value: unknown) {
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).byteLength > maxBodyBytes)
    throw new SelectedPayloadError(
      'This setup exceeds the qualified save size. Reduce images, translated text or configured combinations.',
    );
  return encoded;
}

/** `resendValidityMs`: the session-token validity a resent publish waits for (#468). */
type Request = (path: string, init?: RequestInit, resendValidityMs?: number) => Promise<unknown>;
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const custodyBase = z.strictObject({
  authority: z.string(),
  key: z.uuid(),
  expiresAt: z.number(),
  publish: z.boolean(),
  stage: z.enum(['create', 'save', 'publish']),
  configId: z.string().nullable(),
  draftVersion: z.string().nullable(),
  installationGeneration: z.string(),
  acceptedRevisionId: z.string().nullable().optional(),
});
const journalSchema = custodyBase.extend({ setup: SelectedProductSetupSchema, draft: MerchantDraftSchema.nullable() });
const markerSchema = custodyBase.extend({ requiresReconciliation: z.literal(true) });
const custodySchema = z.union([journalSchema, markerSchema]);
const savedSchema = z.strictObject({ kind: z.literal('saved'), draftVersion: z.string() });
const createdSchema = z.strictObject({ kind: z.literal('created'), configId: z.string() });
const acceptedSchema = z.object({ kind: z.literal('accepted'), state: z.string(), revisionId: z.string().optional() });
const resendSchema = z.object({
  kind: z.literal('resend'),
  revisionId: z.string().optional(),
  minimumValidityMs: z.number(),
});
const publishSchema = z.discriminatedUnion('kind', [acceptedSchema, resendSchema]);
// Each resend waits for a new session token; the server makes progress with every one.
const maxResends = 3;

/** Local custody contains only the exact unresolved write intent, never an authoritative product draft. */
export class SelectedProductReviewChanged extends Error {
  readonly view: ConfigView;
  constructor(view: ConfigView) {
    super('Inherited defaults changed. Review the saved draft before publishing.');
    this.view = view;
  }
}

export class SelectedProductPublicationBlocked extends Error {
  readonly view: ConfigView;
  constructor(view: ConfigView) {
    super(view.config?.publishEligibility.reason ?? 'Publication requires review.');
    this.view = view;
  }
}

export function createSelectedProductClient(input: {
  productId: string;
  request?: Request;
  storage: StoragePort;
  now?: () => number;
  newKey?: () => string;
  onDenied?: () => void;
}) {
  const number = /^gid:\/\/shopify\/Product\/([1-9][0-9]*)$/.exec(input.productId)?.[1];
  if (!number) throw new Error('Invalid product identity');
  const endpoint = `/api/admin/products/${number}/config`;
  const transport: Request =
    input.request ??
    ((path, init, resendValidityMs) => authenticatedJson(path, init, false, resendValidityMs));
  const now = input.now ?? Date.now;
  let current: ConfigView | null = null;
  let scope: { shop: string; authority: string } | null = null;
  let busy = false;
  let disposed = false;
  let unverified = false;
  function assertCurrent() {
    if (disposed) throw new Error('Product context is no longer available');
  }
  function dispose(denied = false) {
    if (disposed) return;
    if (denied && scope) {
      // Retain the operation identity for reconciliation, without retaining private draft contents.
      try {
        const raw = input.storage.getItem(key());
        if (raw) input.storage.setItem(key(), JSON.stringify(asMarker(custodySchema.parse(JSON.parse(raw)))));
      } catch {
        /* Unavailable custody must never enable another write. */
      }
    }
    disposed = true;
    current = null;
    if (denied) input.onDenied?.();
  }
  async function request(path: string, init?: RequestInit, resendValidityMs?: number): Promise<unknown> {
    assertCurrent();
    try {
      const value = await transport(path, init, resendValidityMs);
      assertCurrent();
      return value;
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && (error.status === 401 || error.status === 403))
        dispose(true);
      throw error;
    }
  }
  function key() {
    if (!scope) throw new Error('Product authority not loaded');
    return `insignia:selected-product-write:v1:${scope.shop}:${input.productId}`;
  }
  function asMarker(value: z.infer<typeof custodySchema>) {
    return markerSchema.parse({ ...custodyBase.strip().parse(value), requiresReconciliation: true });
  }
  function pending() {
    const stored = input.storage.getItem(key());
    if (!stored) return null;
    const value = custodySchema.parse(JSON.parse(stored));
    if (value.authority !== scope?.authority) {
      const marker = asMarker(value);
      store(marker);
      return marker;
    }
    if (value.expiresAt <= now() && 'setup' in value) {
      const marker = asMarker(value);
      store(marker);
      return marker;
    }
    return value;
  }
  function store(value: z.infer<typeof custodySchema>) {
    input.storage.setItem(key(), JSON.stringify(value));
  }
  async function resolveOperation(value: z.infer<typeof markerSchema>) {
    const result = z.strictObject({ kind: z.literal('resolved'), publicationRecorded: z.boolean().optional() }).parse(
      await request(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `${value.key}:reconcile`,
          'X-Insignia-Setup-Authority': scope!.authority,
        },
        body: jsonBody({ action: 'reconcile', stage: value.stage, operationKey: value.key }),
      }),
    );
    if (value.stage === 'publish' && result.publicationRecorded === undefined)
      throw new Error('Original publication receipt is unavailable');
    return result.publicationRecorded === true;
  }
  async function reconcile(value: z.infer<typeof markerSchema>) {
    const recorded = await resolveOperation(value);
    if (recorded && value.stage === 'publish' && value.authority === scope?.authority)
      return continuePublication(value);
    input.storage.removeItem(key());
    return refresh();
  }
  async function read() {
    const view = AdminConfigViewSchema.parse(await request(endpoint));
    if (view.product.id !== input.productId) throw new Error('Product identity changed');
    if (
      current?.config &&
      (!view.config ||
        current.config.configId !== view.config.configId ||
        current.config.installationGeneration !== view.config.installationGeneration)
    ) {
      dispose(true);
      throw new Error('Product installation changed');
    }
    return view;
  }
  async function refresh() {
    const view = await read();
    current = view;
    return view;
  }
  async function verifyAuthority() {
    const observed = MerchantPreferencesViewSchema.parse(await request('/api/admin/preferences'));
    if (scope && (observed.shop !== scope.shop || observed.authority !== scope.authority)) {
      dispose(true);
      throw new Error('Selected setup authority changed');
    }
    return observed;
  }
  async function load() {
    const observed = MerchantPreferencesViewSchema.parse(await request('/api/admin/preferences'));
    scope = { shop: observed.shop, authority: observed.authority };
    const view = await refresh();
    const intent = pending(); // Scope-mismatched or malformed custody is never discarded.
    if (intent && !('setup' in intent) && observed.canEdit === true) {
      const recorded = await resolveOperation(intent);
      if (recorded && intent.stage === 'publish' && intent.authority === scope.authority) return view;
      input.storage.removeItem(key());
      return refresh();
    }
    return view;
  }
  function saveBody(value: z.infer<typeof journalSchema>) {
    return jsonBody({ action: 'save', configId: value.configId, draftVersion: value.draftVersion, draft: value.draft });
  }
  async function apply(value: z.infer<typeof journalSchema>) {
    if (!current || !scope) throw new Error('Load product before saving');
    if (value.stage === 'create') {
      const created = createdSchema.parse(
        await request(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': `${value.key}:create`,
            'X-Insignia-Setup-Authority': value.authority,
          },
          body: jsonBody({ action: 'create' }),
        }),
      );
      const view = await refresh();
      if (view.config?.configId !== created.configId) throw new Error('Created configuration changed');
      value = {
        ...value,
        configId: created.configId,
        draftVersion: view.config.draftVersion,
        installationGeneration: view.config.installationGeneration,
        draft: { ...MerchantDraftSchema.parse(view.config.draft), selectedSetup: value.setup },
        stage: 'save',
      };
      try {
        saveBody(value);
      } catch (error) {
        if (error instanceof SelectedPayloadError) input.storage.removeItem(key());
        throw error;
      } // Create is confirmed; this save has never been dispatched.
      store(value);
    }
    if (value.stage === 'save') {
      const saved = savedSchema.parse(
        await request(endpoint, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': `${value.key}:save`,
            'X-Insignia-Setup-Authority': value.authority,
          },
          body: saveBody(value),
        }),
      );
      if (!value.publish) {
        input.storage.removeItem(key());
        unverified = true;
        const view = await refresh();
        if (view.config?.draftVersion !== saved.draftVersion)
          throw Object.assign(new Error('The saved draft changed. Reload and review before editing again.'), {
            status: 409,
          });
        unverified = false;
        return view;
      }
      const savedView = await refresh();
      if (savedView.config?.draftVersion !== saved.draftVersion) {
        input.storage.removeItem(key());
        throw new SelectedProductReviewChanged(savedView);
      }
      const persisted = MerchantDraftSchema.parse(savedView.config.draft).selectedSetup;
      const usedMethods = new Set(
        value.setup.product.views.flatMap((view) => view.placements.flatMap((placement) => placement.methodIds)),
      );
      if (
        !persisted ||
        !sameJson(persisted.product, value.setup.product) ||
        [...usedMethods].some(
          (id) => !sameJson(persisted.methodBindings[id] ?? null, value.setup.methodBindings[id] ?? null),
        )
      ) {
        input.storage.removeItem(key());
        throw new SelectedProductReviewChanged(savedView);
      }
      if (
        !savedView.config.publishEligibility.allowed ||
        isMerchantPublicationOperatorBlocked(savedView.config.publication.state)
      ) {
        input.storage.removeItem(key());
        throw new SelectedProductPublicationBlocked(savedView);
      }
      value = { ...value, setup: persisted, stage: 'publish', draftVersion: saved.draftVersion };
      store(value);
    }
    return continuePublication(value);
  }
  async function continuePublication(value: z.infer<typeof custodySchema>) {
    if (current?.config && isMerchantPublicationOperatorBlocked(current.config.publication.state))
      throw new Error('The existing publication requires operator reconciliation');
    if (!value.configId || !value.draftVersion) throw new Error('Publication identity unavailable');
    const send = (resendValidityMs?: number) =>
      request(
        endpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': `${value.key}:publish`,
            'X-Insignia-Setup-Authority': value.authority,
          },
          body: jsonBody({ action: 'publish', configId: value.configId, draftVersion: value.draftVersion }),
        },
        resendValidityMs,
      );
    let accepted = publishSchema.parse(await send());
    // #468: the staff session ended between publication steps. Re-send the same request (same key and
    // bytes) as soon as a new session token is available; the server resumes from its persisted step.
    for (let resent = 0; accepted.kind === 'resend'; resent++) {
      if (accepted.revisionId && accepted.revisionId !== value.acceptedRevisionId) {
        value = { ...value, acceptedRevisionId: accepted.revisionId };
        store(value);
      }
      if (resent === maxResends)
        // The server stopped it and is not running it: keep custody and offer Retry at once.
        throw new Error('Publication is still in progress');
      accepted = publishSchema.parse(await send(accepted.minimumValidityMs));
    }
    if (accepted.revisionId) {
      value = { ...value, acceptedRevisionId: accepted.revisionId };
      store(value);
    }
    const view = await refresh();
    settlePublication(view, value);
    return view;
  }
  function settlePublication(view: ConfigView, value = pending()) {
    const config = view.config,
      publication = config?.publication;
    if (
      value?.stage !== 'publish' ||
      !config ||
      !publication?.revisionId ||
      config.configId !== value.configId ||
      config.installationGeneration !== value.installationGeneration ||
      publication.sourceDraftVersion !== value.draftVersion ||
      (value.acceptedRevisionId && publication.revisionId !== value.acceptedRevisionId)
    )
      return false;
    // The original request's idempotency key, or the revision it was accepted with, identifies this
    // exact operation even when its response was lost (#436). The server's stored setup is then
    // authoritative, so it need not match the locally journaled bytes.
    const exact = !!value.acceptedRevisionId || publication.requestKey === `${value.key}:publish`;
    const settled =
      publication.state === 'FAILED'
        ? exact
        : publication.state === 'ACTIVE' &&
          publication.activeRevisionId === publication.revisionId &&
          !!config.publishedSetup &&
          (exact ||
            // Byte comparison only for a server that reports no request key; a key identifies the request.
            (publication.requestKey == null &&
              'setup' in value &&
              sameJson(config.publishedSetup.product, value.setup.product)));
    if (settled) input.storage.removeItem(key());
    return settled;
  }
  async function write(setupInput: SelectedProductSetup, publish: boolean) {
    if (busy) throw new Error('A product write is already running');
    if (!current || !scope) throw new Error('Load product before saving');
    assertCurrent();
    if (unverified) throw new Error('Reload the unverified saved draft before continuing');
    busy = true;
    let applying = false;
    let resumed = false; // The write continues an earlier attempt of the same key.
    try {
      const authority = await verifyAuthority();
      if (authority.canEdit !== true) throw new Error('Edit permission required');
      const setup = SelectedProductSetupSchema.parse(setupInput);
      if (setup.product.id !== input.productId) throw new Error('Product identity changed');
      const existing = pending();
      resumed = !!existing;
      if (existing && !('setup' in existing)) throw new Error('Reconcile the original operation before editing');
      if (
        publish &&
        current.config &&
        (isMerchantPublicationOperatorBlocked(current.config.publication.state) ||
          (!existing && isMerchantPublicationContinuing(current.config.publication.state)))
      )
        throw new Error('The existing publication requires reconciliation');
      if (existing && (!sameJson(existing.setup, setup) || existing.publish !== publish))
        throw new Error('Resolve the original pending write before saving different changes.');
      const value =
        existing ??
        journalSchema.parse({
          authority: scope.authority,
          key: (input.newKey ?? (() => crypto.randomUUID()))(),
          expiresAt: now() + 60 * 60 * 1000,
          setup,
          publish,
          stage: current.config ? 'save' : 'create',
          configId: current.config?.configId ?? null,
          draftVersion: current.config?.draftVersion ?? null,
          draft: current.config ? { ...MerchantDraftSchema.parse(current.config.draft), selectedSetup: setup } : null,
          installationGeneration: current.config?.installationGeneration ?? '1',
        });
      if (!existing) {
        jsonBody(setup);
        if (value.stage === 'save') saveBody(value);
      }
      store(value); // Custody must succeed before any mutation is dispatched.
      applying = true;
      return await apply(value);
    } catch (error) {
      if (
        applying &&
        !disposed &&
        error &&
        typeof error === 'object' &&
        (('noEffect' in error && error.noEffect === true) ||
          ('status' in error && [400, 409, 422].includes(Number(error.status))))
      ) {
        const original = pending();
        if (original) {
          try {
            const recorded = await resolveOperation(asMarker(original));
            if (!recorded || original.stage !== 'publish') input.storage.removeItem(key());
          } catch {
            // A rejected duplicate cannot prove a concurrent original did not commit. Keep custody until the barrier settles.
            // The first dispatch of a key has no earlier attempt: the server's own 422 is its final answer, so a
            // fence that cannot be sent must not leave a rejected save looking like a lost one.
            if (!resumed && original.stage !== 'publish' && configRejectionFrom(error)) input.storage.removeItem(key());
          }
        }
      }
      throw error;
    } finally {
      busy = false;
    }
  }
  return {
    load,
    refresh,
    dispose,
    isBusy: () => busy,
    isUnverified: () => unverified,
    peek: async () => {
      await verifyAuthority();
      return read();
    },
    adoptObservation: (view: ConfigView) => {
      assertCurrent();
      if (busy || unverified) return false;
      if (
        current?.config?.configId !== view.config?.configId ||
        current?.config?.installationGeneration !== view.config?.installationGeneration ||
        current?.config?.draftVersion !== view.config?.draftVersion
      )
        return false;
      current = view;
      settlePublication(view);
      return true;
    },
    adoptCurrency: (currency: string) => {
      if (!current?.config || current.config.currentShopCurrency !== currency || pending())
        throw new Error('Currency cannot be adopted in the current write state');
      current = {
        ...current,
        config: {
          ...current.config,
          draft: { ...MerchantDraftSchema.parse(current.config.draft), shopCurrency: currency },
        },
      };
    },
    save: (setup: SelectedProductSetup) => write(setup, false),
    publish: (setup: SelectedProductSetup) => write(setup, true),
    retry: async () => {
      const value = pending();
      if (!value) throw new Error('No pending product write');
      if ('setup' in value) return write(value.setup, value.publish);
      if (busy) throw new Error('A product write is already running');
      busy = true;
      try {
        const authority = await verifyAuthority();
        if (authority.canEdit !== true) throw new Error('Edit permission required');
        return await reconcile(value);
      } finally {
        busy = false;
      }
    },
    hasPending: () => {
      try {
        return !!pending();
      } catch {
        return true;
      }
    },
    /** The unresolved write is a publish request whose draft save was already confirmed. */
    hasPendingPublication: () => {
      try {
        return pending()?.stage === 'publish';
      } catch {
        return false;
      }
    },
  };
}
