export type ConfigWriteRequest = {
  method: 'POST' | 'PUT';
  body: object;
  key: string;
  installationGeneration?: string;
};

export type ConfigPublicationObservation = {
  configId: string;
  installationGeneration: string;
  state: string;
  requestKey: string | null;
  sourceDraftVersion: string | null;
};

export type ConfigSaveObservation =
  | {
      kind: 'current';
      configId: string;
      installationGeneration: string;
      draftVersion: string;
      draft: unknown;
    }
  | { kind: 'missing' };

export type ConfigSaveReconciliation = 'committed' | 'unchanged' | 'conflict' | 'context-changed' | 'unavailable';

export type MerchantConfigTransaction = {
  save:
    | { kind: 'clean' }
    | { kind: 'dirty' }
    | { kind: 'saved' }
    | { kind: 'conflict' }
    | { kind: 'saving'; request: ConfigWriteRequest }
    | { kind: 'ambiguous'; request: ConfigWriteRequest };
  publication: { kind: 'idle' } | { kind: 'pending'; request: ConfigWriteRequest; attempt: 'idle' | 'sending' };
};

export type MerchantConfigTransactionEvent =
  | { type: 'draft-edited' }
  | { type: 'draft-discarded' }
  | { type: 'draft-loaded' }
  | { type: 'server-draft-changed' }
  | { type: 'page-suspended' }
  | { type: 'authorization-cleared' }
  | { type: 'save-started'; request: ConfigWriteRequest }
  | { type: 'save-retried'; request: ConfigWriteRequest }
  | { type: 'save-confirmed'; request: ConfigWriteRequest }
  | { type: 'save-response-rejected'; request: ConfigWriteRequest }
  | { type: 'save-response-conflict'; request: ConfigWriteRequest }
  | { type: 'save-response-ambiguous'; request: ConfigWriteRequest }
  | { type: 'save-load-observed'; request: ConfigWriteRequest; observation: ConfigSaveObservation | null }
  | { type: 'publication-started'; request: ConfigWriteRequest }
  | { type: 'publication-attempt-finished'; request: ConfigWriteRequest }
  | { type: 'publication-response-rejected'; request: ConfigWriteRequest }
  | { type: 'publication-context-cleared' }
  | {
      type: 'publication-observed';
      observation: ConfigPublicationObservation;
      storedRequest: ConfigWriteRequest | null;
    };

const terminalPublicationStates = new Set(['RESTORATION_CONFLICT', 'ACTIVE', 'CONFLICT', 'OPERATOR_HOLD', 'FAILED']);

export function initialMerchantConfigTransaction(): MerchantConfigTransaction {
  return { save: { kind: 'clean' }, publication: { kind: 'idle' } };
}

export function saveRequestOf(state: MerchantConfigTransaction): ConfigWriteRequest | null {
  return state.save.kind === 'saving' || state.save.kind === 'ambiguous' ? state.save.request : null;
}

export function publicationRequestOf(state: MerchantConfigTransaction): ConfigWriteRequest | null {
  return state.publication.kind === 'pending' ? state.publication.request : null;
}

function sameWriteRequest(left: ConfigWriteRequest, right: ConfigWriteRequest): boolean {
  return (
    left.method === right.method &&
    left.key === right.key &&
    left.installationGeneration === right.installationGeneration &&
    JSON.stringify(left.body) === JSON.stringify(right.body)
  );
}

function matchesSaveRequest(
  state: MerchantConfigTransaction,
  request: ConfigWriteRequest,
): state is MerchantConfigTransaction & { save: { kind: 'saving'; request: ConfigWriteRequest } } {
  return state.save.kind === 'saving' && state.save.request === request;
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

export function reconcileConfigSave(
  request: ConfigWriteRequest,
  observation: ConfigSaveObservation | null,
): ConfigSaveReconciliation {
  if (!observation) return 'unavailable';
  if (observation.kind === 'missing') return 'context-changed';
  if (request.method !== 'PUT' || !request.installationGeneration) return 'unavailable';
  const body = request.body as {
    action?: unknown;
    configId?: unknown;
    draftVersion?: unknown;
    draft?: unknown;
  };
  if (
    body.action !== 'save' ||
    typeof body.configId !== 'string' ||
    typeof body.draftVersion !== 'string' ||
    !/^[1-9][0-9]*$/.test(body.draftVersion)
  )
    return 'unavailable';
  if (observation.configId !== body.configId || observation.installationGeneration !== request.installationGeneration)
    return 'context-changed';

  const baseVersion = BigInt(body.draftVersion);
  if (!/^[1-9][0-9]*$/.test(observation.draftVersion)) return 'unavailable';
  const observedVersion = BigInt(observation.draftVersion);
  if (observedVersion < baseVersion) return 'unavailable';
  if (observedVersion === baseVersion) return 'unchanged';
  if (observedVersion === baseVersion + 1n && canonical(observation.draft) === canonical(body.draft))
    return 'committed';
  return 'conflict';
}

function publicationFromObservation(
  state: MerchantConfigTransaction,
  observation: ConfigPublicationObservation,
  storedRequest: ConfigWriteRequest | null,
): MerchantConfigTransaction['publication'] {
  const ownedRequest = publicationRequestOf(state) ?? storedRequest;
  const body = ownedRequest?.body as { action?: string; configId?: string; draftVersion?: string } | undefined;

  if (
    terminalPublicationStates.has(observation.state) &&
    ownedRequest?.method === 'POST' &&
    body?.action === 'publish' &&
    body.configId === observation.configId &&
    typeof body.draftVersion === 'string' &&
    typeof ownedRequest.key === 'string' &&
    ownedRequest.key.length > 0 &&
    ownedRequest.installationGeneration === observation.installationGeneration &&
    (observation.requestKey !== ownedRequest.key || observation.sourceDraftVersion !== body.draftVersion)
  )
    return {
      kind: 'pending',
      request: ownedRequest,
      attempt:
        state.publication.kind === 'pending' && sameWriteRequest(state.publication.request, ownedRequest)
          ? state.publication.attempt
          : 'idle',
    };

  if (terminalPublicationStates.has(observation.state)) return { kind: 'idle' };

  const recoveryRequest = publicationRequestOf(state) ?? storedRequest;
  const recoveryBody = recoveryRequest?.body as
    | { action?: string; configId?: string; draftVersion?: string }
    | undefined;
  const serverMatches =
    observation.state === 'DRAFT' ||
    (recoveryBody?.draftVersion === observation.sourceDraftVersion &&
      (!observation.requestKey || recoveryRequest?.key === observation.requestKey));
  const requestMatches =
    recoveryRequest?.method === 'POST' &&
    recoveryBody?.action === 'publish' &&
    recoveryBody.configId === observation.configId &&
    recoveryRequest.installationGeneration === observation.installationGeneration &&
    typeof recoveryBody.draftVersion === 'string' &&
    serverMatches;

  return requestMatches
    ? {
        kind: 'pending',
        request: recoveryRequest,
        attempt:
          state.publication.kind === 'pending' && sameWriteRequest(state.publication.request, recoveryRequest)
            ? state.publication.attempt
            : 'idle',
      }
    : { kind: 'idle' };
}

export function transitionMerchantConfigTransaction(
  state: MerchantConfigTransaction,
  event: MerchantConfigTransactionEvent,
): MerchantConfigTransaction {
  switch (event.type) {
    case 'draft-edited':
      if (state.save.kind === 'saving' || state.save.kind === 'ambiguous') return state;
      if (state.save.kind === 'conflict') return state;
      return state.save.kind === 'dirty' ? state : { ...state, save: { kind: 'dirty' } };
    case 'draft-loaded':
      if (state.save.kind === 'saving' || state.save.kind === 'ambiguous') return state;
      return state.save.kind === 'clean' ? state : { ...state, save: { kind: 'clean' } };
    case 'server-draft-changed':
      if (state.save.kind === 'saving' || state.save.kind === 'ambiguous' || state.save.kind === 'conflict')
        return state;
      return { ...state, save: { kind: 'conflict' } };
    case 'draft-discarded':
      return state.save.kind === 'clean' ? state : { ...state, save: { kind: 'clean' } };
    case 'page-suspended': {
      const save =
        state.save.kind === 'saving' ? { kind: 'ambiguous' as const, request: state.save.request } : state.save;
      const publication =
        state.publication.kind === 'pending' && state.publication.attempt === 'sending'
          ? { ...state.publication, attempt: 'idle' as const }
          : state.publication;
      return save === state.save && publication === state.publication ? state : { ...state, save, publication };
    }
    case 'authorization-cleared':
      return initialMerchantConfigTransaction();
    case 'save-started':
      return state.save.kind === 'dirty' ? { ...state, save: { kind: 'saving', request: event.request } } : state;
    case 'save-retried':
      return state.save.kind === 'ambiguous' && state.save.request === event.request
        ? { ...state, save: { kind: 'saving', request: event.request } }
        : state;
    case 'save-confirmed':
      return matchesSaveRequest(state, event.request) ? { ...state, save: { kind: 'saved' } } : state;
    case 'save-response-rejected':
      return matchesSaveRequest(state, event.request) ? { ...state, save: { kind: 'dirty' } } : state;
    case 'save-response-conflict':
      return matchesSaveRequest(state, event.request) ? { ...state, save: { kind: 'conflict' } } : state;
    case 'save-response-ambiguous':
      return matchesSaveRequest(state, event.request)
        ? { ...state, save: { kind: 'ambiguous', request: event.request } }
        : state;
    case 'save-load-observed': {
      const currentRequest = saveRequestOf(state);
      if (!currentRequest || currentRequest !== event.request) return state;
      const outcome = reconcileConfigSave(event.request, event.observation);
      if (outcome === 'committed') return { ...state, save: { kind: 'saved' } };
      if (outcome === 'conflict') return { ...state, save: { kind: 'conflict' } };
      if (outcome === 'context-changed') return { ...state, save: { kind: 'clean' } };
      return state.save.kind === 'ambiguous'
        ? state
        : { ...state, save: { kind: 'ambiguous', request: currentRequest } };
    }
    case 'publication-started':
      return state.publication.kind === 'idle'
        ? { ...state, publication: { kind: 'pending', request: event.request, attempt: 'sending' } }
        : state.publication.attempt === 'idle' && sameWriteRequest(state.publication.request, event.request)
          ? { ...state, publication: { ...state.publication, attempt: 'sending' } }
          : state;
    case 'publication-attempt-finished':
      return state.publication.kind === 'pending' &&
        state.publication.attempt === 'sending' &&
        sameWriteRequest(state.publication.request, event.request)
        ? { ...state, publication: { ...state.publication, attempt: 'idle' } }
        : state;
    case 'publication-response-rejected':
      return state.publication.kind === 'pending' &&
        state.publication.attempt === 'sending' &&
        sameWriteRequest(state.publication.request, event.request)
        ? { ...state, publication: { kind: 'idle' } }
        : state;
    case 'publication-context-cleared':
      return state.publication.kind === 'idle' ? state : { ...state, publication: { kind: 'idle' } };
    case 'publication-observed':
      return {
        ...state,
        publication: publicationFromObservation(state, event.observation, event.storedRequest),
      };
  }
}
