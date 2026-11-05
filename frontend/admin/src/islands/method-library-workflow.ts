import {
  createMethodLibraryWriteCommand,
  initialMethodLibraryTransaction,
  type MethodLibraryTransaction,
  type MethodLibraryTransactionEvent,
  type MethodLibraryWriteCommand,
  transitionMethodLibraryTransaction,
} from './method-library-transaction.ts';

export type LibraryMethod = { id: string; name: string; version: string };
export type MethodLibraryErrorReason =
  | 'read-failed'
  | 'response-invalid'
  | 'write-rejected'
  | 'write-uncertain'
  | 'authorization-denied';
export type MethodLibraryNotice = 'method-removed' | 'library-saved';
type Snapshot = {
  transaction: MethodLibraryTransaction;
  methods: LibraryMethod[];
  error: MethodLibraryErrorReason | null;
  notice: MethodLibraryNotice | null;
};
type Dependencies = {
  request: (path: string, init?: RequestInit, freshSession?: boolean) => Promise<unknown>;
  key: () => string;
  changed: () => void;
};

// One instance owns the retained command and all list/write attempts for one mounted page.
// Suspension invalidates completions; only a fresh authenticated read permits manual replay.
export function createMethodLibraryWorkflow({ request, key, changed }: Dependencies) {
  let state: Snapshot = { transaction: initialMethodLibraryTransaction(), methods: [], error: null, notice: null };
  let epoch = 0;
  let disposed = false;
  let requiresFreshSession = false;

  function update(patch: Partial<Snapshot>) {
    if (disposed) return;
    state = { ...state, ...patch };
    changed();
  }

  function transition(event: MethodLibraryTransactionEvent): boolean {
    if (disposed) return false;
    const next = transitionMethodLibraryTransaction(state.transaction, event);
    if (next === state.transaction) return false;
    update({ transaction: next });
    return true;
  }

  function denied(error: unknown): boolean {
    const status = errorStatus(error);
    if (status !== 401 && status !== 403) return false;
    epoch++;
    requiresFreshSession = true;
    update({ methods: [], notice: null });
    transition({ type: 'authorization-denied' });
    return true;
  }

  async function load(freshSession = false): Promise<boolean> {
    if (!transition({ type: 'method-read-started' })) return false;
    const attempt = ++epoch;
    update({ error: null });
    try {
      const result = await request('/api/admin/methods', {}, freshSession || requiresFreshSession);
      if (disposed || attempt !== epoch) return false;
      const methods = readMethods(result);
      requiresFreshSession = false;
      update({ methods });
      transition({ type: 'method-read-succeeded' });
      return true;
    } catch (error) {
      if (disposed || attempt !== epoch) return false;
      if (!denied(error)) transition({ type: 'method-read-failed' });
      update({
        error:
          errorStatus(error) === 401 || errorStatus(error) === 403
            ? 'authorization-denied'
            : error instanceof MethodLibraryResponseError
              ? 'response-invalid'
              : 'read-failed',
      });
      return false;
    }
  }

  async function execute(command: MethodLibraryWriteCommand, retry = false): Promise<void> {
    if (!transition({ type: retry ? 'method-write-retried' : 'method-write-started', command })) return;
    const attempt = ++epoch;
    update({ error: null, notice: null });
    try {
      const result = await request(
        `/api/admin/methods${command.methodId ? `/${encodeURIComponent(command.methodId)}` : ''}`,
        {
          method: command.method,
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': command.key },
          body: JSON.stringify(command.body),
        },
      );
      if (disposed || attempt !== epoch) return;
      const saved = command.method === 'DELETE' ? undefined : readMethod(result, command.methodId);
      const methods =
        command.method === 'DELETE'
          ? state.methods.filter((method) => method.id !== command.methodId)
          : saved
            ? command.method === 'POST'
              ? [...state.methods.filter((method) => method.id !== saved.id), saved]
              : state.methods.map((method) => (method.id === saved.id ? saved : method))
            : state.methods;
      update({ methods });
      transition({ type: 'method-write-succeeded', command });
      update({
        notice: command.method === 'DELETE' ? 'method-removed' : 'library-saved',
      });
    } catch (error) {
      if (disposed || attempt !== epoch) return;
      if (!denied(error)) {
        const status = errorStatus(error);
        transition({
          type:
            status && status >= 400 && status < 500 && status !== 408 && status !== 429
              ? 'method-write-rejected'
              : 'method-write-uncertain',
          command,
        });
      }
      const status = errorStatus(error);
      update({
        error:
          status === 401 || status === 403
            ? 'authorization-denied'
            : status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429
              ? 'write-rejected'
              : 'write-uncertain',
      });
    }
  }

  async function retry(): Promise<void> {
    const write = state.transaction.write;
    if (write.kind === 'uncertain') await execute(write.command, true);
  }

  return {
    get snapshot(): Snapshot {
      return state;
    },
    load,
    openCreate() {
      if (transition({ type: 'create-dialog-opened' })) update({ error: null });
    },
    openRename(methodId: string) {
      const method = state.methods.find((item) => item.id === methodId);
      if (method && transition({ type: 'rename-dialog-opened', methodId, name: method.name })) update({ error: null });
    },
    enterName(name: string) {
      transition({ type: 'method-name-entered', name });
    },
    closeEditor() {
      transition({ type: 'editor-dialog-closed' });
    },
    openRemoval(methodId: string) {
      if (
        state.methods.some((method) => method.id === methodId) &&
        transition({ type: 'remove-dialog-opened', methodId })
      )
        update({ error: null });
    },
    closeRemoval() {
      transition({ type: 'remove-dialog-closed' });
    },
    async submitEditor(): Promise<void> {
      if (state.transaction.write.kind === 'uncertain') return retry();
      const editor = state.transaction.editor;
      if (editor.kind === 'closed' || state.transaction.write.kind !== 'idle' || !editor.name.trim()) return;
      const name = editor.name.trim();
      if (editor.kind === 'create') await execute(createMethodLibraryWriteCommand('POST', null, { name }, key()));
      else {
        const method = state.methods.find((item) => item.id === editor.methodId);
        if (method && method.name !== name)
          await execute(createMethodLibraryWriteCommand('PUT', method.id, { name, version: method.version }, key()));
      }
    },
    async confirmRemoval(): Promise<void> {
      if (state.transaction.write.kind === 'uncertain') return retry();
      const removal = state.transaction.removal;
      if (removal.kind === 'closed' || state.transaction.write.kind !== 'idle') return;
      const method = state.methods.find((item) => item.id === removal.methodId);
      if (method)
        await execute(createMethodLibraryWriteCommand('DELETE', method.id, { version: method.version }, key()));
    },
    retry,
    suspend() {
      epoch++;
      requiresFreshSession = true;
      update({ methods: [], error: null, notice: null });
      transition({ type: 'page-suspended' });
    },
    dispose() {
      disposed = true;
      epoch++;
      state = { transaction: initialMethodLibraryTransaction(), methods: [], error: null, notice: null };
    },
  };
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error) || typeof error.status !== 'number')
    return undefined;
  return error.status;
}

class MethodLibraryResponseError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseMethod(value: unknown): LibraryMethod {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !value.id ||
    typeof value.name !== 'string' ||
    !value.name ||
    typeof value.version !== 'string' ||
    !value.version
  )
    throw new MethodLibraryResponseError();
  return { id: value.id, name: value.name, version: value.version };
}

function readMethod(value: unknown, expectedId: string | null): LibraryMethod {
  const method = parseMethod(isRecord(value) ? value.method : undefined);
  if (expectedId && method.id !== expectedId) throw new MethodLibraryResponseError();
  return method;
}

function readMethods(value: unknown): LibraryMethod[] {
  if (!isRecord(value) || !Array.isArray(value.methods)) throw new MethodLibraryResponseError();
  const methods = value.methods.map(parseMethod);
  if (new Set(methods.map((method) => method.id)).size !== methods.length) throw new MethodLibraryResponseError();
  return methods;
}
