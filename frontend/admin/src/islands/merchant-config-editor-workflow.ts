import { type MerchantDraft, MerchantDraftSchema } from '@insignia/contracts';
import { type GeometryV1, validateGeometry } from '@insignia/ui-visualizer/geometry';
import type { CatalogProduct, ConfigView, PublicationState } from '../shared/admin-view.js';
import {
  type ConfigPublicationObservation,
  type ConfigWriteRequest,
  initialMerchantConfigTransaction,
  type MerchantConfigTransaction,
  type MerchantConfigTransactionEvent,
  publicationRequestOf,
  reconcileConfigSave,
  saveRequestOf,
  transitionMerchantConfigTransaction,
} from './merchant-config-transaction.ts';

export type MerchantConfigEditorProductList = {
  products: CatalogProduct[];
  nextCursor: string | null;
};

export type MerchantConfigEditorWorkflowSnapshot = {
  view: ConfigView | null;
  draft: MerchantDraft | null;
  latest: ConfigView['config'] | null;
  transaction: MerchantConfigTransaction;
  busy: boolean;
  loading: boolean;
  copyCandidates: MerchantConfigEditorProductList | null;
};

export interface MerchantConfigEditorWorkflowPorts {
  productId: string;
  readCurrent(freshSession?: boolean): Promise<ConfigView>;
  send(request: ConfigWriteRequest): Promise<Record<string, unknown>>;
  readProducts(query: string): Promise<MerchantConfigEditorProductList>;
  publicationRequests: {
    read(productId: string): ConfigWriteRequest | null;
    write(productId: string, request: ConfigWriteRequest): void;
    clear(productId: string): void;
  };
  newRequestKey(): string;
}

export type MerchantConfigEditorLoadOutcome =
  | {
      kind: 'loaded';
      reason: 'regular' | 'save-committed' | 'save-conflict' | 'save-uncertain' | 'context-changed' | 'unsupported';
    }
  | { kind: 'denied'; message: string }
  | { kind: 'failed'; message: string }
  | { kind: 'ignored' };

export type MerchantConfigEditorSaveOutcome =
  | { kind: 'saved' }
  | { kind: 'saved-unverified' }
  | { kind: 'saved-after-interruption' }
  | { kind: 'conflict'; draftReset: boolean }
  | { kind: 'context-changed' }
  | { kind: 'uncertain' }
  | { kind: 'rejected'; message: string; validationIssues: { path: string; message: string }[] }
  | { kind: 'denied'; message: string }
  | { kind: 'failed'; message: string }
  | { kind: 'ignored' };

export type MerchantConfigEditorPublicationOutcome =
  | { kind: 'refreshed' }
  | { kind: 'pending' }
  | { kind: 'rejected'; message: string }
  | { kind: 'uncertain'; message: string }
  | { kind: 'unrecoverable'; message: string }
  | { kind: 'denied'; message: string }
  | { kind: 'failed'; message: string }
  | { kind: 'ignored' };

export type MerchantConfigEditorRefreshOutcome =
  | { kind: 'refreshed' }
  | { kind: 'denied'; message: string }
  | { kind: 'failed'; message: string }
  | { kind: 'ignored' };

export type MerchantConfigEditorCreateOutcome =
  | { kind: 'created'; load: MerchantConfigEditorLoadOutcome }
  | { kind: 'denied'; message: string }
  | { kind: 'failed'; message: string }
  | { kind: 'ignored' };

export type MerchantConfigEditorSearchOutcome =
  | { kind: 'found'; products: MerchantConfigEditorProductList }
  | { kind: 'denied'; message: string }
  | { kind: 'failed'; message: string }
  | { kind: 'ignored' };

export type MerchantConfigEditorCopyOutcome =
  | { kind: 'copied'; path: string }
  | { kind: 'invalid-target' }
  | { kind: 'denied'; message: string }
  | { kind: 'failed'; message: string }
  | { kind: 'ignored' };

const publicationInProgress = new Set<PublicationState>([
  'PUBLISH_REQUESTED',
  'REMOTE_PENDING',
  'REMOTE_READY_ACTIVATION_PENDING',
  'ACTIVATION_WAITING_RELEASE',
  'ACTIVATION_WAITING_HOLD',
  'HELD_ACTIVATION_PENDING',
  'ACTIVATED_RESTORATION_PENDING',
]);

export const isMerchantPublicationContinuing = (state: PublicationState) => publicationInProgress.has(state);

export const isMerchantPublicationOperatorBlocked = (state: PublicationState) =>
  state === 'OPERATOR_HOLD' || state === 'RESTORATION_CONFLICT' || state === 'CONFLICT';

const terminalPublication = new Set<PublicationState>(['ACTIVE', 'FAILED']);

function productNumber(id: string) {
  return /^gid:\/\/shopify\/(?:Product|ProductVariant)\/([1-9][0-9]*)$/.exec(id)?.[1];
}

function publicationObservation(config: NonNullable<ConfigView['config']>): ConfigPublicationObservation {
  return {
    configId: config.configId,
    installationGeneration: config.installationGeneration,
    state: config.publication.state,
    requestKey: config.publication.requestKey,
    sourceDraftVersion: config.publication.sourceDraftVersion,
  };
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined;
  return typeof error.status === 'number' ? error.status : undefined;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function authorizationDenied(error: unknown): boolean {
  const status = statusOf(error);
  return status === 401 || status === 403;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'undefined';
}

export function isEditableMerchantDraft(value: unknown): value is MerchantDraft {
  const parsed = MerchantDraftSchema.safeParse(value);
  if (!parsed.success) return false;
  try {
    return !!validateGeometry(parsed.data.geometry as GeometryV1);
  } catch {
    return false;
  }
}

function snapshotDraft(value: MerchantDraft): MerchantDraft {
  const copy = structuredClone(value);
  if (copy.labels)
    for (const group of Object.values({ ...copy.labels, values: undefined }))
      if (group) for (const [id, label] of Object.entries(group)) group[id] = label.trim();
  if (copy.labels?.values)
    for (const group of Object.values(copy.labels.values))
      for (const [id, label] of Object.entries(group)) group[id] = label.trim();
  return copy;
}

function configObservation(config: NonNullable<ConfigView['config']>) {
  return {
    kind: 'current' as const,
    configId: config.configId,
    installationGeneration: config.installationGeneration,
    draftVersion: config.draftVersion,
    draft: config.draft,
  };
}

function publicationContextError(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 403 });
}

export interface MerchantConfigEditorWorkflow {
  getSnapshot(): MerchantConfigEditorWorkflowSnapshot;
  subscribe(listener: () => void): () => void;
  load(): Promise<MerchantConfigEditorLoadOutcome>;
  resume(): Promise<MerchantConfigEditorLoadOutcome>;
  refreshWhenIdle(): Promise<MerchantConfigEditorLoadOutcome>;
  refreshPublication(): Promise<MerchantConfigEditorRefreshOutcome>;
  editDraft(update: MerchantDraft | ((current: MerchantDraft | null) => MerchantDraft | null)): boolean;
  markDraftEdited(): boolean;
  discardDraft(): MerchantDraft | null;
  adoptLatest(): MerchantDraft | null;
  saveDraft(ready: boolean): Promise<MerchantConfigEditorSaveOutcome>;
  retrySave(): Promise<MerchantConfigEditorSaveOutcome>;
  publish(ready: boolean): Promise<MerchantConfigEditorPublicationOutcome>;
  createConfiguration(): Promise<MerchantConfigEditorCreateOutcome>;
  searchCopyProducts(query: string): Promise<MerchantConfigEditorSearchOutcome>;
  copyTo(target: string, ready: boolean): Promise<MerchantConfigEditorCopyOutcome>;
  suspend(): void;
  clearAuthorization(): void;
  dispose(): void;
}

export function createMerchantConfigEditorWorkflow(
  ports: MerchantConfigEditorWorkflowPorts,
): MerchantConfigEditorWorkflow {
  let state: MerchantConfigEditorWorkflowSnapshot = {
    view: null,
    draft: null,
    latest: null,
    transaction: initialMerchantConfigTransaction(),
    busy: false,
    loading: true,
    copyCandidates: null,
  };
  let requestEpoch = 0;
  let observationEpoch = 0;
  // Keep an unresolved create's exact command in this document. The create
  // endpoint is idempotent by key, so a deliberate retry can safely replay it.
  // This is intentionally not persisted: full document destruction discards
  // private command bodies and the next page load reconciles from server state.
  let pendingCreate: ConfigWriteRequest | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();

  function notify(next: Partial<MerchantConfigEditorWorkflowSnapshot>) {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  }

  function transition(event: MerchantConfigTransactionEvent) {
    const transaction = transitionMerchantConfigTransaction(state.transaction, event);
    if (transaction !== state.transaction) notify({ transaction });
    return transaction;
  }

  function canEdit() {
    return (
      !disposed &&
      !state.loading &&
      !state.busy &&
      !!state.view?.config &&
      !!state.draft &&
      !saveRequestOf(state.transaction)
    );
  }

  function clearStorage() {
    try {
      ports.publicationRequests.clear(ports.productId);
    } catch {
      // Durable publication identity remains in the in-memory transaction.
    }
  }

  function readStoredPublication(): ConfigWriteRequest | null {
    try {
      return ports.publicationRequests.read(ports.productId);
    } catch {
      return null;
    }
  }

  function writeStoredPublication(request: ConfigWriteRequest) {
    try {
      ports.publicationRequests.write(ports.productId, request);
    } catch {
      // The deterministic request key remains recoverable from the server observation.
    }
  }

  function syncPublication(data: ConfigView) {
    const config = data.config;
    if (!config) {
      transition({ type: 'publication-context-cleared' });
      clearStorage();
      return;
    }
    transition({
      type: 'publication-observed',
      observation: publicationObservation(config),
      storedRequest: readStoredPublication(),
    });
    if (!publicationRequestOf(state.transaction)) clearStorage();
  }

  function clearPrivateState(loading: boolean) {
    requestEpoch++;
    observationEpoch++;
    pendingCreate = null;
    const transaction = transitionMerchantConfigTransaction(state.transaction, { type: 'authorization-cleared' });
    notify({ view: null, draft: null, latest: null, busy: false, loading, copyCandidates: null, transaction });
  }

  function productMatches(data: ConfigView): boolean {
    return data.product.id === `gid://shopify/Product/${ports.productId}`;
  }

  function publicationReadMatches(
    data: ConfigView,
    expected: NonNullable<ConfigView['config']>,
  ): data is ConfigView & { config: NonNullable<ConfigView['config']> } {
    return (
      productMatches(data) &&
      !!data.config &&
      data.config.configId === expected.configId &&
      data.config.installationGeneration === expected.installationGeneration
    );
  }

  async function load(freshSession: boolean): Promise<MerchantConfigEditorLoadOutcome> {
    if (disposed) return { kind: 'ignored' };
    if (freshSession && state.busy) suspend();
    if (state.busy) return { kind: 'ignored' };
    const epoch = ++requestEpoch;
    observationEpoch++;
    notify({
      view: null,
      draft: null,
      latest: null,
      loading: true,
      copyCandidates: null,
    });
    try {
      if (!/^[1-9][0-9]*$/.test(ports.productId)) throw new Error('Invalid product link');
      const data = await ports.readCurrent(freshSession);
      if (epoch !== requestEpoch) return { kind: 'ignored' };
      if (!productMatches(data)) {
        clearPrivateState(false);
        return {
          kind: 'failed',
          message: 'Current product could not be verified. Reopen this page to check the saved configuration.',
        };
      }

      // An authenticated read is the source of truth after an uncertain create.
      // Keep the command only while the product is still unconfigured.
      if (data.config) pendingCreate = null;

      syncPublication(data);
      const pendingSave = saveRequestOf(state.transaction);
      const value = data.config && isEditableMerchantDraft(data.config.draft) ? data.config.draft : null;
      if (!pendingSave) {
        transition({ type: 'draft-loaded' });
        notify({ view: data, draft: value ? structuredClone(value) : null, latest: null });
        return { kind: 'loaded', reason: data.config && !value ? 'unsupported' : 'regular' };
      }

      const observation = data.config ? configObservation(data.config) : { kind: 'missing' as const };
      const outcome = reconcileConfigSave(pendingSave, observation);
      transition({ type: 'save-load-observed', request: pendingSave, observation });
      const attempted = (pendingSave.body as { draft?: unknown }).draft;
      if (outcome === 'context-changed') {
        notify({ view: data, draft: value ? structuredClone(value) : null, latest: null });
        return { kind: 'loaded', reason: 'context-changed' };
      }

      const resumedDraft = outcome === 'committed' ? value : isEditableMerchantDraft(attempted) ? attempted : value;
      const latest = outcome === 'conflict' ? data.config : null;
      notify({ view: data, draft: resumedDraft ? structuredClone(resumedDraft) : null, latest });
      if (outcome === 'committed') return { kind: 'loaded', reason: 'save-committed' };
      if (outcome === 'conflict') return { kind: 'loaded', reason: 'save-conflict' };
      return { kind: 'loaded', reason: 'save-uncertain' };
    } catch (error) {
      if (epoch !== requestEpoch) return { kind: 'ignored' };
      if (authorizationDenied(error)) {
        clearPrivateState(false);
        return { kind: 'denied', message: messageOf(error, 'Current authorization required') };
      }
      return { kind: 'failed', message: messageOf(error, 'Admin data unavailable') };
    } finally {
      if (epoch === requestEpoch) notify({ loading: false });
    }
  }

  async function readPublication(expectedEpoch: number): Promise<
    | {
        kind: 'observed';
        publication: NonNullable<ConfigView['config']>['publication'];
        draftVersion: string;
      }
    | { kind: 'ignored' }
  > {
    const viewAtStart = state.view;
    if (!viewAtStart?.config) throw new Error('Publication context unavailable');
    const epoch = requestEpoch;
    const observation = ++observationEpoch;
    let data: ConfigView;
    try {
      data = await ports.readCurrent(false);
    } catch (error) {
      if (epoch !== requestEpoch || expectedEpoch !== requestEpoch) return { kind: 'ignored' };
      const status = statusOf(error);
      if (observation !== observationEpoch && status !== 401 && status !== 403) return { kind: 'ignored' };
      throw error;
    }
    if (epoch !== requestEpoch || expectedEpoch !== requestEpoch || observation !== observationEpoch)
      return { kind: 'ignored' };
    if (!publicationReadMatches(data, viewAtStart.config))
      throw publicationContextError('Publication context changed. Reload before continuing.');

    syncPublication(data);
    const current = state.view;
    if (!current?.config || current.config.configId !== viewAtStart.config.configId) return { kind: 'ignored' };
    const sameSavedDraft =
      data.config.draftVersion === viewAtStart.config.draftVersion &&
      canonical(data.config.draft) === canonical(JSON.parse(JSON.stringify(viewAtStart.config.draft)));
    const transaction = sameSavedDraft
      ? state.transaction
      : transitionMerchantConfigTransaction(state.transaction, { type: 'server-draft-changed' });
    notify({
      view: {
        ...current,
        product: { ...current.product, status: data.product.status },
        config: {
          ...current.config,
          publication: data.config.publication,
          currentShopCurrency: data.config.currentShopCurrency,
          publishEligibility: sameSavedDraft
            ? data.config.publishEligibility
            : { allowed: false, reason: 'The saved draft changed. Reload before requesting a new publication.' },
        },
      },
      latest: sameSavedDraft ? null : data.config,
      transaction,
    });
    return { kind: 'observed', publication: data.config.publication, draftVersion: data.config.draftVersion };
  }

  async function refreshPublication(): Promise<MerchantConfigEditorRefreshOutcome> {
    if (disposed || state.busy || !state.view?.config) return { kind: 'ignored' };
    const epoch = requestEpoch;
    try {
      const result = await readPublication(epoch);
      return result.kind === 'observed' ? { kind: 'refreshed' } : { kind: 'ignored' };
    } catch (error) {
      if (epoch !== requestEpoch) return { kind: 'ignored' };
      if (authorizationDenied(error)) {
        clearPrivateState(false);
        return { kind: 'denied', message: messageOf(error, 'Current authorization required') };
      }
      const current = state.view;
      if (current?.config)
        notify({
          view: {
            ...current,
            config: {
              ...current.config,
              publishEligibility: { allowed: false, reason: 'Current readiness could not be verified.' },
            },
          },
        });
      return { kind: 'failed', message: messageOf(error, 'Current Admin state unavailable') };
    }
  }

  function claim(): number | null {
    if (disposed || state.loading || state.busy) return null;
    const epoch = requestEpoch;
    observationEpoch++;
    notify({ busy: true });
    return epoch;
  }

  function release(epoch: number) {
    if (epoch === requestEpoch && state.busy) notify({ busy: false });
  }

  function handleDenied(error: unknown) {
    clearPrivateState(false);
    return { kind: 'denied' as const, message: messageOf(error, 'Current authorization required') };
  }

  async function performSave(request: ConfigWriteRequest, retry: boolean): Promise<MerchantConfigEditorSaveOutcome> {
    const commandEpoch = claim();
    if (commandEpoch === null) return { kind: 'ignored' };
    const previous = state.transaction;
    const started = transition(retry ? { type: 'save-retried', request } : { type: 'save-started', request });
    if (started === previous) {
      release(commandEpoch);
      return { kind: 'ignored' };
    }
    const epoch = requestEpoch;
    observationEpoch++;
    try {
      const response = await ports.send(request);
      if (epoch !== requestEpoch) return { kind: 'ignored' };
      const body = request.body as { configId: string; draftVersion: string; draft: MerchantDraft };
      const savedVersion = response.draftVersion;
      if (
        response.kind !== 'saved' ||
        typeof savedVersion !== 'string' ||
        !/^[1-9][0-9]*$/.test(savedVersion) ||
        !/^[1-9][0-9]*$/.test(body.draftVersion) ||
        BigInt(savedVersion) !== BigInt(body.draftVersion) + 1n
      )
        throw new Error('Invalid successful save response');

      const viewAtStart = state.view;
      if (
        viewAtStart?.config &&
        viewAtStart.config.configId === body.configId &&
        viewAtStart.config.installationGeneration === request.installationGeneration &&
        viewAtStart.config.draftVersion === body.draftVersion
      )
        notify({
          view: {
            ...viewAtStart,
            config: {
              ...viewAtStart.config,
              draft: body.draft,
              draftVersion: savedVersion,
              publishEligibility: {
                allowed: false,
                reason: 'Publication eligibility has not been verified for this saved draft. Reload before publishing.',
              },
            },
          },
        });
      notify({ draft: body.draft });
      transition({ type: 'save-confirmed', request });
      if (!viewAtStart?.config) {
        release(commandEpoch);
        const loaded = await load(true);
        return loaded.kind === 'denied'
          ? { kind: 'denied', message: loaded.message }
          : loaded.kind === 'failed'
            ? { kind: 'failed', message: loaded.message }
            : { kind: 'saved' };
      }

      try {
        const refreshed = await ports.readCurrent(false);
        if (epoch !== requestEpoch) return { kind: 'ignored' };
        const config = refreshed.config;
        if (
          !productMatches(refreshed) ||
          !config ||
          config.configId !== body.configId ||
          config.installationGeneration !== request.installationGeneration ||
          config.draftVersion !== savedVersion ||
          canonical(config.draft) !== canonical(JSON.parse(JSON.stringify(body.draft))) ||
          typeof config.publishEligibility?.allowed !== 'boolean' ||
          !(config.publishEligibility.reason === null || typeof config.publishEligibility.reason === 'string')
        )
          throw new Error('Publication eligibility does not match the saved draft');
        notify({ view: refreshed });
      } catch (error) {
        if (epoch !== requestEpoch) return { kind: 'ignored' };
        if (authorizationDenied(error)) return handleDenied(error);
        return { kind: 'saved-unverified' };
      }
      return { kind: 'saved' };
    } catch (error) {
      if (epoch !== requestEpoch) return { kind: 'ignored' };
      if (authorizationDenied(error)) return handleDenied(error);
      const status = statusOf(error);
      // A timeout or throttle may be generated after the command reached the service.
      if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429) {
        const issues = (error as { validationIssues?: unknown }).validationIssues;
        const validationIssues = Array.isArray(issues)
          ? issues
              .filter(
                (issue): issue is { path: string; message: string } =>
                  !!issue &&
                  typeof issue === 'object' &&
                  'path' in issue &&
                  typeof issue.path === 'string' &&
                  'message' in issue &&
                  typeof issue.message === 'string',
              )
              .slice(0, 20)
          : [];
        transition({ type: 'save-response-rejected', request });
        return { kind: 'rejected', message: messageOf(error, 'Save denied'), validationIssues };
      }

      const body = request.body as { configId: string; draftVersion: string; draft: MerchantDraft };
      let result: ConfigView | null = null;
      try {
        result = await ports.readCurrent(false);
      } catch (readError) {
        if (epoch !== requestEpoch) return { kind: 'ignored' };
        if (authorizationDenied(readError)) return handleDenied(readError);
      }
      if (epoch !== requestEpoch) return { kind: 'ignored' };
      if (result && !productMatches(result))
        return handleDenied(publicationContextError('Current product could not be verified.'));
      const observation = result?.config
        ? configObservation(result.config)
        : result
          ? { kind: 'missing' as const }
          : null;
      const attemptedDraft = isEditableMerchantDraft(body.draft) ? body.draft : null;
      const outcome = reconcileConfigSave(request, observation);
      if (outcome === 'context-changed') {
        transition({ type: 'save-load-observed', request, observation });
        const currentDraft =
          result?.config && isEditableMerchantDraft(result.config.draft) ? result.config.draft : null;
        notify({ view: result, draft: currentDraft ? structuredClone(currentDraft) : null, latest: null });
        return { kind: 'context-changed' };
      }
      if (status === 409) {
        transition({ type: 'save-response-conflict', request });
        notify({ latest: result?.config ?? null });
        if (!state.view && result)
          notify({ view: result, draft: attemptedDraft ? structuredClone(attemptedDraft) : null });
        return { kind: 'conflict', draftReset: !state.view && !!result };
      }

      transition({ type: 'save-load-observed', request, observation });
      if (outcome === 'committed' && result?.config && isEditableMerchantDraft(result.config.draft)) {
        notify({ view: result, draft: structuredClone(result.config.draft), latest: null });
        return { kind: 'saved-after-interruption' };
      }
      const conflict = outcome === 'conflict';
      const draftReset = !state.view && !!result && !!attemptedDraft;
      notify({
        latest: conflict ? (result?.config ?? null) : null,
        ...(result && !state.view ? { view: result } : {}),
        ...(attemptedDraft && !state.view ? { draft: structuredClone(attemptedDraft) } : {}),
      });
      return conflict ? { kind: 'conflict', draftReset } : { kind: 'uncertain' };
    } finally {
      release(commandEpoch);
    }
  }

  async function saveDraft(ready: boolean): Promise<MerchantConfigEditorSaveOutcome> {
    const current = state;
    if (
      !ready ||
      current.loading ||
      current.busy ||
      current.transaction.save.kind !== 'dirty' ||
      !current.view?.config ||
      !current.draft
    )
      return { kind: 'ignored' };
    const config = current.view.config;
    const request: ConfigWriteRequest = {
      method: 'PUT',
      body: {
        action: 'save',
        configId: config.configId,
        draftVersion: config.draftVersion,
        draft: snapshotDraft(current.draft),
      },
      key: ports.newRequestKey(),
      installationGeneration: config.installationGeneration,
    };
    return performSave(request, false);
  }

  async function retrySave(): Promise<MerchantConfigEditorSaveOutcome> {
    const current = state;
    const request = saveRequestOf(current.transaction);
    const config = current.view?.config;
    if (current.loading || current.busy || current.transaction.save.kind !== 'ambiguous' || !request || !config)
      return { kind: 'ignored' };
    const body = request.body as { configId?: unknown; draftVersion?: unknown };
    if (
      body.configId !== config.configId ||
      request.installationGeneration !== config.installationGeneration ||
      body.draftVersion !== config.draftVersion
    )
      return { kind: 'ignored' };
    return performSave(request, true);
  }

  async function publish(ready: boolean): Promise<MerchantConfigEditorPublicationOutcome> {
    if (state.loading || state.busy) return { kind: 'ignored' };
    const config = state.view?.config;
    if (!config || isMerchantPublicationOperatorBlocked(config.publication.state)) return { kind: 'ignored' };
    const pending = publicationRequestOf(state.transaction);
    const continuing = isMerchantPublicationContinuing(config.publication.state);
    if (
      !continuing &&
      !pending &&
      (!ready || !config.publishEligibility.allowed || !['clean', 'saved'].includes(state.transaction.save.kind))
    )
      return { kind: 'ignored' };

    const sourceVersion = continuing ? config.publication.sourceDraftVersion : config.draftVersion;
    if (!pending && !sourceVersion)
      return {
        kind: 'unrecoverable',
        message: 'The original publication request cannot be recovered. Contact an operator before retrying.',
      };
    const request =
      pending ??
      ({
        method: 'POST',
        body: { action: 'publish', configId: config.configId, draftVersion: sourceVersion },
        installationGeneration: config.installationGeneration,
        key:
          continuing && config.publication.requestKey
            ? config.publication.requestKey
            : `m5pub_${config.configId}_${config.installationGeneration}_${sourceVersion}`,
      } satisfies ConfigWriteRequest);
    const commandEpoch = claim();
    if (commandEpoch === null) return { kind: 'ignored' };
    const before = state.transaction;
    const started = transition({ type: 'publication-started', request });
    if (started === before) {
      release(commandEpoch);
      return { kind: 'ignored' };
    }
    const epoch = requestEpoch;
    writeStoredPublication(request);
    try {
      let phase = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await ports.send(request);
        if (epoch !== requestEpoch) return { kind: 'ignored' };
        phase = String(result.state ?? '');
        if (!['PUBLISH_REQUESTED', 'REMOTE_PENDING'].includes(phase)) break;
      }
      const refreshed = await readPublication(epoch);
      if (epoch !== requestEpoch || refreshed.kind === 'ignored') return { kind: 'ignored' };
      return ['PUBLISH_REQUESTED', 'REMOTE_PENDING'].includes(phase) ? { kind: 'pending' } : { kind: 'refreshed' };
    } catch (error) {
      if (epoch !== requestEpoch) return { kind: 'ignored' };
      if (authorizationDenied(error)) return handleDenied(error);
      let observed:
        | {
            publication: NonNullable<ConfigView['config']>['publication'];
            draftVersion: string;
          }
        | undefined;
      try {
        const refreshed = await readPublication(epoch);
        if (refreshed.kind === 'observed')
          observed = { publication: refreshed.publication, draftVersion: refreshed.draftVersion };
      } catch (refreshError) {
        if (epoch !== requestEpoch) return { kind: 'ignored' };
        if (authorizationDenied(refreshError)) return handleDenied(refreshError);
      }
      if (epoch !== requestEpoch) return { kind: 'ignored' };
      const requestBody = request.body as { configId?: unknown; draftVersion?: unknown };
      const currentConfig = state.view?.config;
      if (
        statusOf(error) === 409 &&
        observed?.publication.state === 'DRAFT' &&
        observed.publication.requestKey === null &&
        observed.publication.sourceDraftVersion === null &&
        currentConfig &&
        currentConfig.configId === requestBody.configId &&
        currentConfig.installationGeneration === request.installationGeneration &&
        observed.draftVersion !== requestBody.draftVersion
      ) {
        transition({ type: 'publication-response-rejected', request });
        clearStorage();
        return {
          kind: 'rejected',
          message: 'The saved draft changed before this publication was accepted. Review it and publish again.',
        };
      }
      if (
        observed?.publication.requestKey === request.key &&
        observed.publication.sourceDraftVersion === requestBody.draftVersion &&
        (terminalPublication.has(observed.publication.state) || isMerchantPublicationOperatorBlocked(observed.publication.state))
      )
        return { kind: 'refreshed' };
      return {
        kind: 'uncertain',
        message:
          error instanceof Error
            ? `${error.message}. Continue the same publication request after checking its current state.`
            : 'Publication result is uncertain. Continue the same request.',
      };
    } finally {
      if (epoch === requestEpoch) transition({ type: 'publication-attempt-finished', request });
      release(commandEpoch);
    }
  }

  async function createConfiguration(): Promise<MerchantConfigEditorCreateOutcome> {
    if (state.busy || state.loading || !state.view || state.view.config) return { kind: 'ignored' };
    const epoch = claim();
    if (epoch === null) return { kind: 'ignored' };
    const request =
      pendingCreate ??
      ({ method: 'POST', body: { action: 'create' }, key: ports.newRequestKey() } satisfies ConfigWriteRequest);
    pendingCreate = request;
    try {
      const response = await ports.send(request);
      if (epoch !== requestEpoch) return { kind: 'ignored' };
      if (response.kind !== 'created' || typeof response.configId !== 'string' || !response.configId) {
        // A malformed 2xx response has the same uncertainty as a lost response.
        release(epoch);
        return reconcileCreate(epoch, 'Create response could not be verified.');
      }
      release(epoch);
      const loaded = await load(false);
      if (loaded.kind === 'ignored') return { kind: 'ignored' };
      if (loaded.kind === 'denied') return { kind: 'denied', message: loaded.message };
      if (loaded.kind === 'failed') return { kind: 'failed', message: loaded.message };
      if (loaded.kind === 'loaded' && state.view?.config) {
        pendingCreate = null;
        return { kind: 'created', load: loaded };
      }
      return {
        kind: 'failed',
        message: 'Configuration creation was acknowledged, but the saved configuration could not be found.',
      };
    } catch (error) {
      if (epoch !== requestEpoch) return { kind: 'ignored' };
      if (authorizationDenied(error)) return handleDenied(error);
      const status = statusOf(error);
      if (status === 409) {
        // A 409 is definitive for this idempotency key. Reconcile the product
        // before allowing the editor to report creation or mint another key.
        release(epoch);
        const result = await reconcileCreate(epoch, messageOf(error, 'Product already has a configuration'));
        if (result.kind === 'created') pendingCreate = null;
        if (result.kind === 'failed' && state.view && !state.view.config) pendingCreate = null;
        return result;
      }
      if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) {
        pendingCreate = null;
        return { kind: 'failed', message: messageOf(error, 'Create failed') };
      }
      release(epoch);
      return reconcileCreate(epoch, messageOf(error, 'Create result is uncertain.'));
    } finally {
      release(epoch);
    }
  }

  async function reconcileCreate(epoch: number, fallbackMessage: string): Promise<MerchantConfigEditorCreateOutcome> {
    if (epoch !== requestEpoch) return { kind: 'ignored' };
    // `load` verifies the authenticated product identity and clears the private
    // command only after it observes a configuration. If no config exists, or
    // the read is unavailable, the exact command remains available for a
    // deliberate retry after the page has re-established its view.
    const loaded = await load(true);
    if (loaded.kind === 'ignored') return { kind: 'ignored' };
    if (loaded.kind === 'denied') return { kind: 'denied', message: loaded.message };
    if (loaded.kind === 'failed') return { kind: 'failed', message: loaded.message };
    if (loaded.kind === 'loaded' && state.view?.config) {
      pendingCreate = null;
      return { kind: 'created', load: loaded };
    }
    return { kind: 'failed', message: fallbackMessage };
  }

  async function searchCopyProducts(query: string): Promise<MerchantConfigEditorSearchOutcome> {
    if (!state.view?.config) return { kind: 'ignored' };
    const epoch = claim();
    if (epoch === null) return { kind: 'ignored' };
    notify({ copyCandidates: null });
    try {
      const products = await ports.readProducts(query);
      if (epoch !== requestEpoch) return { kind: 'ignored' };
      notify({ copyCandidates: products });
      return { kind: 'found', products };
    } catch (error) {
      if (epoch !== requestEpoch) return { kind: 'ignored' };
      if (authorizationDenied(error)) return handleDenied(error);
      return { kind: 'failed', message: messageOf(error, 'Destination products could not be loaded.') };
    } finally {
      release(epoch);
    }
  }

  async function copyTo(target: string, ready: boolean): Promise<MerchantConfigEditorCopyOutcome> {
    const current = state;
    if (
      current.busy ||
      current.loading ||
      !ready ||
      !current.view?.config ||
      !['clean', 'saved'].includes(current.transaction.save.kind) ||
      !current.copyCandidates?.products.some(
        (product) => productNumber(product.id) === target && target !== ports.productId,
      )
    )
      return { kind: 'ignored' };
    const productId = target.trim();
    if (!/^[1-9][0-9]*$/.test(productId)) return { kind: 'invalid-target' };
    const epoch = claim();
    if (epoch === null) return { kind: 'ignored' };
    try {
      await ports.send({
        method: 'POST',
        body: { action: 'copy', targetProductId: `gid://shopify/Product/${productId}` },
        key: ports.newRequestKey(),
      });
      if (epoch !== requestEpoch) return { kind: 'ignored' };
      return { kind: 'copied', path: `/admin/products/${productId}/config` };
    } catch (error) {
      if (epoch !== requestEpoch) return { kind: 'ignored' };
      if (authorizationDenied(error)) return handleDenied(error);
      return { kind: 'failed', message: messageOf(error, 'Copy failed') };
    } finally {
      release(epoch);
    }
  }

  function editDraft(update: MerchantDraft | ((current: MerchantDraft | null) => MerchantDraft | null)): boolean {
    if (!canEdit()) return false;
    const next = typeof update === 'function' ? update(state.draft) : update;
    if (!next || next === state.draft) return false;
    const transaction = transitionMerchantConfigTransaction(state.transaction, { type: 'draft-edited' });
    notify({ draft: next, transaction });
    return true;
  }

  function markDraftEdited(): boolean {
    if (!canEdit()) return false;
    const transaction = transitionMerchantConfigTransaction(state.transaction, { type: 'draft-edited' });
    if (transaction === state.transaction) return false;
    notify({ transaction });
    return true;
  }

  function discardDraft(): MerchantDraft | null {
    if (!canEdit() || !state.view?.config || !isEditableMerchantDraft(state.view.config.draft)) return null;
    // After a save conflict, the rendered view may still hold the old baseline.
    // Discarding local edits must adopt the authenticated latest snapshot, or
    // leave the conflict intact if that snapshot cannot be edited.
    if (state.transaction.save.kind === 'conflict') return adoptLatest();
    const draft = structuredClone(state.view.config.draft);
    const transaction = transitionMerchantConfigTransaction(state.transaction, { type: 'draft-discarded' });
    notify({ draft, latest: null, transaction });
    return draft;
  }

  function adoptLatest(): MerchantDraft | null {
    const latest = state.latest;
    if (
      !canEdit() ||
      !state.view?.config ||
      !latest ||
      latest.configId !== state.view.config.configId ||
      latest.installationGeneration !== state.view.config.installationGeneration ||
      !isEditableMerchantDraft(latest.draft)
    )
      return null;
    const draft = structuredClone(latest.draft);
    const transaction = transitionMerchantConfigTransaction(state.transaction, { type: 'draft-loaded' });
    notify({ view: { ...state.view, config: latest }, draft, latest: null, transaction });
    return draft;
  }

  function suspend() {
    if (disposed) return;
    requestEpoch++;
    observationEpoch++;
    const transaction = transitionMerchantConfigTransaction(state.transaction, { type: 'page-suspended' });
    notify({ view: null, draft: null, latest: null, busy: false, loading: true, copyCandidates: null, transaction });
  }

  function clearAuthorization() {
    if (disposed) return;
    clearPrivateState(false);
  }

  function dispose() {
    if (disposed) return;
    clearPrivateState(false);
    disposed = true;
    listeners.clear();
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load: () => load(false),
    resume: () => load(true),
    async refreshWhenIdle() {
      if (
        disposed ||
        state.busy ||
        state.loading ||
        saveRequestOf(state.transaction) ||
        !['clean', 'saved'].includes(state.transaction.save.kind)
      )
        return { kind: 'ignored' };
      return load(false);
    },
    refreshPublication,
    editDraft,
    markDraftEdited,
    discardDraft,
    adoptLatest,
    saveDraft,
    retrySave,
    publish,
    createConfiguration,
    searchCopyProducts,
    copyTo,
    suspend,
    clearAuthorization,
    dispose,
  };
}
