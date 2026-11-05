export type MethodLibraryWriteMethod = 'POST' | 'PUT' | 'DELETE';

export type MethodLibraryWriteCommand = {
  method: MethodLibraryWriteMethod;
  methodId: string | null;
  body: object;
  key: string;
  signature: string;
};

export type MethodLibraryTransaction = {
  read: 'idle' | 'loading' | 'ready' | 'failed' | 'denied' | 'suspended';
  write:
    | { kind: 'idle' }
    | { kind: 'writing'; command: MethodLibraryWriteCommand }
    | { kind: 'uncertain'; command: MethodLibraryWriteCommand };
  editorRevision: number;
  editor: { kind: 'closed' } | { kind: 'create'; name: string } | { kind: 'rename'; methodId: string; name: string };
  removalRevision: number;
  removal: { kind: 'closed' } | { kind: 'confirming'; methodId: string };
};

export type MethodLibraryTransactionEvent =
  | { type: 'method-read-started' }
  | { type: 'method-read-succeeded' }
  | { type: 'method-read-failed' }
  | { type: 'page-suspended' }
  | { type: 'authorization-denied' }
  | { type: 'create-dialog-opened' }
  | { type: 'rename-dialog-opened'; methodId: string; name: string }
  | { type: 'method-name-entered'; name: string }
  | { type: 'editor-dialog-closed' }
  | { type: 'remove-dialog-opened'; methodId: string }
  | { type: 'remove-dialog-closed' }
  | { type: 'method-write-started'; command: MethodLibraryWriteCommand }
  | { type: 'method-write-retried'; command: MethodLibraryWriteCommand }
  | { type: 'method-write-succeeded'; command: MethodLibraryWriteCommand }
  | { type: 'method-write-rejected'; command: MethodLibraryWriteCommand }
  | { type: 'method-write-uncertain'; command: MethodLibraryWriteCommand };

export function methodWriteSignature(method: MethodLibraryWriteMethod, methodId: string | null, body: object): string {
  return JSON.stringify([method, methodId, body]);
}

export function createMethodLibraryWriteCommand(
  method: MethodLibraryWriteMethod,
  methodId: string | null,
  body: object,
  key: string,
): MethodLibraryWriteCommand {
  return { method, methodId, body, key, signature: methodWriteSignature(method, methodId, body) };
}

export function initialMethodLibraryTransaction(): MethodLibraryTransaction {
  return {
    read: 'idle',
    write: { kind: 'idle' },
    editorRevision: 0,
    editor: { kind: 'closed' },
    removalRevision: 0,
    removal: { kind: 'closed' },
  };
}

function currentWriteMatches(
  state: MethodLibraryTransaction,
  command: MethodLibraryWriteCommand,
): state is MethodLibraryTransaction & { write: { kind: 'writing'; command: MethodLibraryWriteCommand } } {
  return state.write.kind === 'writing' && state.write.command === command;
}

export function transitionMethodLibraryTransaction(
  state: MethodLibraryTransaction,
  event: MethodLibraryTransactionEvent,
): MethodLibraryTransaction {
  switch (event.type) {
    case 'method-read-started':
      return state.read !== 'loading' && state.write.kind !== 'writing' ? { ...state, read: 'loading' } : state;
    case 'method-read-succeeded':
      return { ...state, read: 'ready', editor: { kind: 'closed' }, removal: { kind: 'closed' } };
    case 'method-read-failed':
      return { ...state, read: 'failed' };
    case 'page-suspended':
      return {
        ...state,
        read: state.read === 'denied' ? 'denied' : 'suspended',
        write: state.write.kind === 'writing' ? { kind: 'uncertain', command: state.write.command } : state.write,
        editor: { kind: 'closed' },
        removal: { kind: 'closed' },
      };
    case 'authorization-denied':
      return {
        read: 'denied',
        write: { kind: 'idle' },
        editorRevision: state.editorRevision,
        editor: { kind: 'closed' },
        removalRevision: state.removalRevision,
        removal: { kind: 'closed' },
      };
    case 'create-dialog-opened':
      return state.read === 'ready' && state.write.kind === 'idle'
        ? {
            ...state,
            editorRevision: state.editorRevision + 1,
            editor: { kind: 'create', name: '' },
            removal: { kind: 'closed' },
          }
        : state;
    case 'rename-dialog-opened':
      return state.read === 'ready' && state.write.kind === 'idle'
        ? {
            ...state,
            editorRevision: state.editorRevision + 1,
            editor: { kind: 'rename', methodId: event.methodId, name: event.name },
            removal: { kind: 'closed' },
          }
        : state;
    case 'method-name-entered':
      if (state.write.kind !== 'idle' || state.editor.kind === 'closed') return state;
      return state.editor.name === event.name ? state : { ...state, editor: { ...state.editor, name: event.name } };
    case 'editor-dialog-closed':
      return state.editor.kind === 'closed' ? state : { ...state, editor: { kind: 'closed' } };
    case 'remove-dialog-opened':
      return state.read === 'ready' && state.write.kind === 'idle'
        ? {
            ...state,
            editor: { kind: 'closed' },
            removalRevision: state.removalRevision + 1,
            removal: { kind: 'confirming', methodId: event.methodId },
          }
        : state;
    case 'remove-dialog-closed':
      return state.removal.kind === 'closed' ? state : { ...state, removal: { kind: 'closed' } };
    case 'method-write-started':
      return state.read === 'ready' && state.write.kind === 'idle'
        ? { ...state, write: { kind: 'writing', command: event.command } }
        : state;
    case 'method-write-retried':
      return state.write.kind === 'uncertain' && state.write.command === event.command && state.read === 'ready'
        ? { ...state, write: { kind: 'writing', command: event.command } }
        : state;
    case 'method-write-succeeded':
      return currentWriteMatches(state, event.command)
        ? { ...state, write: { kind: 'idle' }, editor: { kind: 'closed' }, removal: { kind: 'closed' } }
        : state;
    case 'method-write-rejected':
      return currentWriteMatches(state, event.command) ? { ...state, write: { kind: 'idle' } } : state;
    case 'method-write-uncertain':
      return currentWriteMatches(state, event.command)
        ? { ...state, write: { kind: 'uncertain', command: event.command } }
        : state;
  }
}
