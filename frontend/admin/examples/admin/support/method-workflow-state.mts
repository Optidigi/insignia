/** The local Methods explorer owns saved method observations, its active draft, and staged dialogs. */
import type { MethodConfiguration, MethodErrors } from './method-configuration.mts';

export type MethodDuplicateFailureReason = 'invalid-name' | 'storage-failure';

export type MethodWorkflowNavigationTarget =
  | { kind: 'method-route'; path: string }
  | { kind: 'external'; href: string }
  | { kind: 'history'; delta: number };

export type MethodWorkflowSubDialog =
  | { kind: 'closed' }
  | { kind: 'product-picker'; id: string; browse: 'products' | 'collections' }
  | { kind: 'remove'; id: string; targets: MethodConfiguration[] }
  | {
      kind: 'duplicate';
      id: string;
      source: MethodConfiguration;
      name: string;
      copyAssignment: boolean;
      error: MethodDuplicateFailureReason | null;
    };
export type MethodWorkflowDialog =
  | MethodWorkflowSubDialog
  | { kind: 'leave'; id: string; target: MethodWorkflowNavigationTarget; resume: MethodWorkflowSubDialog };

export interface MethodWorkflowState {
  methods: MethodConfiguration[];
  editor: MethodConfiguration | null;
  editorSessionId: string;
  newMethodBaseline: MethodConfiguration;
  errors: MethodErrors;
  dialog: MethodWorkflowDialog;
}

export function createMethodWorkflowState(
  methods: readonly MethodConfiguration[],
  editor: MethodConfiguration | null,
  editorSessionId: string,
  newMethodBaseline: MethodConfiguration,
): MethodWorkflowState {
  return {
    methods: methods.map((method) => structuredClone(method)),
    editor: editor ? structuredClone(editor) : null,
    editorSessionId,
    newMethodBaseline: structuredClone(newMethodBaseline),
    errors: {},
    dialog: { kind: 'closed' },
  };
}

function clearError(errors: MethodErrors, field: keyof MethodErrors): MethodErrors {
  if (!(field in errors)) return errors;
  const next = { ...errors };
  delete next[field];
  return next;
}

export function methodWorkflowDirty(state: MethodWorkflowState): boolean {
  if (!state.editor) return false;
  const saved = state.methods.find((method) => method.id === state.editor?.id) ?? state.newMethodBaseline;
  return JSON.stringify(state.editor) !== JSON.stringify(saved);
}

export type MethodWorkflowEvent =
  | { type: 'route-opened'; sessionId: string; editor: MethodConfiguration | null }
  | { type: 'method-name-edited'; sessionId: string; value: string }
  | { type: 'method-explanation-edited'; sessionId: string; value: string }
  | {
      type: 'method-translation-edited';
      sessionId: string;
      locale: string;
      field: 'name' | 'explanation';
      value: string;
    }
  | { type: 'pricing-kind-changed'; sessionId: string; value: MethodConfiguration['pricing'] }
  | { type: 'default-price-edited'; sessionId: string; value: string }
  | { type: 'assignment-mode-changed'; sessionId: string; value: MethodConfiguration['assignment'] }
  | { type: 'tag-match-changed'; sessionId: string; value: MethodConfiguration['tagMatch'] }
  | { type: 'tag-toggled'; sessionId: string; tag: string; checked: boolean }
  | { type: 'manual-products-selected'; sessionId: string; productIds: string[] }
  | { type: 'validation-failed'; sessionId: string; errors: MethodErrors }
  | { type: 'draft-discarded'; sessionId: string }
  | { type: 'method-saved'; sessionId: string; method: MethodConfiguration }
  | { type: 'product-picker-opened'; id: string; browse: 'products' | 'collections' }
  | { type: 'product-picker-canceled'; id: string }
  | { type: 'product-picker-applied'; id: string; productIds: string[] }
  | { type: 'removal-opened'; id: string; targets: MethodConfiguration[] }
  | { type: 'removal-canceled'; id: string }
  | { type: 'methods-deleted'; id: string; methodIds: string[] }
  | { type: 'duplicate-opened'; id: string; source: MethodConfiguration; suggestedName: string }
  | { type: 'duplicate-name-edited'; id: string; value: string }
  | { type: 'duplicate-assignment-toggled'; id: string; checked: boolean }
  | { type: 'duplicate-failed'; id: string; reason: MethodDuplicateFailureReason }
  | { type: 'duplicate-canceled'; id: string }
  | { type: 'method-duplicated'; id: string; method: MethodConfiguration }
  | {
      type: 'navigation-requested';
      confirmationId: string;
      target: MethodWorkflowNavigationTarget;
      additionalDirty?: boolean;
    }
  | { type: 'navigation-confirmed'; id: string }
  | { type: 'navigation-canceled'; id: string };

export function methodWorkflowReducer(state: MethodWorkflowState, event: MethodWorkflowEvent): MethodWorkflowState {
  switch (event.type) {
    case 'route-opened':
      return {
        ...state,
        editor: event.editor ? structuredClone(event.editor) : null,
        editorSessionId: event.sessionId,
        errors: {},
        dialog: { kind: 'closed' },
      };
    case 'method-name-edited':
      return state.editor && state.editorSessionId === event.sessionId
        ? { ...state, editor: { ...state.editor, name: event.value }, errors: clearError(state.errors, 'name') }
        : state;
    case 'method-explanation-edited':
      return state.editor && state.editorSessionId === event.sessionId
        ? { ...state, editor: { ...state.editor, explanation: event.value } }
        : state;
    case 'method-translation-edited': {
      if (
        !state.editor ||
        state.editorSessionId !== event.sessionId ||
        !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(event.locale)
      )
        return state;
      const translations = { ...state.editor.translations };
      const fields = { ...translations[event.locale] };
      if (event.value === '') delete fields[event.field];
      else fields[event.field] = event.value;
      if (Object.keys(fields).length) translations[event.locale] = fields;
      else delete translations[event.locale];
      const editor: MethodConfiguration = { ...state.editor, translations };
      if (!Object.keys(translations).length) delete editor.translations;
      return { ...state, editor, errors: clearError(state.errors, 'name') };
    }
    case 'pricing-kind-changed':
      return state.editor && state.editorSessionId === event.sessionId
        ? { ...state, editor: { ...state.editor, pricing: event.value }, errors: clearError(state.errors, 'amount') }
        : state;
    case 'default-price-edited':
      return state.editor && state.editorSessionId === event.sessionId
        ? { ...state, editor: { ...state.editor, amount: event.value }, errors: clearError(state.errors, 'amount') }
        : state;
    case 'assignment-mode-changed':
      return state.editor && state.editorSessionId === event.sessionId
        ? { ...state, editor: { ...state.editor, assignment: event.value }, errors: clearError(state.errors, 'tags') }
        : state;
    case 'tag-match-changed':
      return state.editor && state.editorSessionId === event.sessionId
        ? { ...state, editor: { ...state.editor, tagMatch: event.value } }
        : state;
    case 'tag-toggled': {
      if (!state.editor || state.editorSessionId !== event.sessionId) return state;
      const tags = event.checked
        ? state.editor.tags.includes(event.tag)
          ? state.editor.tags
          : [...state.editor.tags, event.tag]
        : state.editor.tags.filter((tag) => tag !== event.tag);
      return { ...state, editor: { ...state.editor, tags }, errors: clearError(state.errors, 'tags') };
    }
    case 'manual-products-selected':
      return state.editor && state.editorSessionId === event.sessionId
        ? { ...state, editor: { ...state.editor, productIds: [...event.productIds] } }
        : state;
    case 'validation-failed':
      return state.editor && state.editorSessionId === event.sessionId
        ? { ...state, errors: { ...event.errors } }
        : state;
    case 'draft-discarded': {
      if (!state.editor || state.editorSessionId !== event.sessionId) return state;
      const saved = state.methods.find((method) => method.id === state.editor?.id);
      return { ...state, editor: structuredClone(saved ?? state.newMethodBaseline), errors: {} };
    }
    case 'method-saved': {
      if (!state.editor || state.editorSessionId !== event.sessionId) return state;
      const method = structuredClone(event.method);
      const methods = state.methods.some((item) => item.id === method.id)
        ? state.methods.map((item) => (item.id === method.id ? method : item))
        : [...state.methods, method];
      return { ...state, methods, editor: method, errors: {} };
    }
    case 'product-picker-opened':
      return state.editor && state.dialog.kind === 'closed'
        ? { ...state, dialog: { kind: 'product-picker', id: event.id, browse: event.browse } }
        : state;
    case 'product-picker-canceled':
    case 'duplicate-canceled':
    case 'removal-canceled':
      return state.dialog.kind !== 'closed' && state.dialog.kind !== 'leave' && state.dialog.id === event.id
        ? { ...state, dialog: { kind: 'closed' } }
        : state;
    case 'product-picker-applied':
      return state.dialog.kind === 'product-picker' && state.dialog.id === event.id && state.editor
        ? {
            ...state,
            editor: { ...state.editor, productIds: [...event.productIds] },
            dialog: { kind: 'closed' },
          }
        : state;
    case 'removal-opened':
      return state.dialog.kind === 'closed'
        ? { ...state, dialog: { kind: 'remove', id: event.id, targets: structuredClone(event.targets) } }
        : state;
    case 'methods-deleted': {
      if (state.dialog.kind !== 'remove' || state.dialog.id !== event.id) return state;
      const ids = new Set(event.methodIds);
      const methods = state.methods.filter((method) => !ids.has(method.id));
      return {
        ...state,
        methods,
        editor: state.editor && ids.has(state.editor.id) ? null : state.editor,
        dialog: { kind: 'closed' },
      };
    }
    case 'duplicate-opened':
      return state.dialog.kind === 'closed'
        ? {
            ...state,
            dialog: {
              kind: 'duplicate',
              id: event.id,
              source: structuredClone(event.source),
              name: event.suggestedName,
              copyAssignment: false,
              error: null,
            },
          }
        : state;
    case 'duplicate-name-edited':
      return state.dialog.kind === 'duplicate' && state.dialog.id === event.id
        ? { ...state, dialog: { ...state.dialog, name: event.value, error: null } }
        : state;
    case 'duplicate-assignment-toggled':
      return state.dialog.kind === 'duplicate' && state.dialog.id === event.id
        ? { ...state, dialog: { ...state.dialog, copyAssignment: event.checked } }
        : state;
    case 'duplicate-failed':
      return state.dialog.kind === 'duplicate' && state.dialog.id === event.id
        ? { ...state, dialog: { ...state.dialog, error: event.reason } }
        : state;
    case 'method-duplicated':
      return state.dialog.kind === 'duplicate' && state.dialog.id === event.id
        ? { ...state, methods: [...state.methods, structuredClone(event.method)], dialog: { kind: 'closed' } }
        : state;
    case 'navigation-canceled':
      return state.dialog.kind === 'leave' && state.dialog.id === event.id
        ? { ...state, dialog: state.dialog.resume }
        : state;
    case 'navigation-requested':
      return requestMethodNavigation(state, event.target, event.confirmationId, event.additionalDirty).state;
    case 'navigation-confirmed':
      return confirmMethodNavigation(state, event.id).state;
  }
}

export type MethodNavigationDecision =
  | { kind: 'navigate'; target: MethodWorkflowNavigationTarget }
  | { kind: 'confirm'; id: string };

export function requestMethodNavigation(
  state: MethodWorkflowState,
  target: MethodWorkflowNavigationTarget,
  confirmationId: string,
  additionalDirty = false,
): { state: MethodWorkflowState; decision: MethodNavigationDecision } {
  if (!methodWorkflowDirty(state) && !additionalDirty) return { state, decision: { kind: 'navigate', target } };
  if (state.dialog.kind === 'leave') return { state, decision: { kind: 'confirm', id: state.dialog.id } };
  return {
    state: { ...state, dialog: { kind: 'leave', id: confirmationId, target, resume: state.dialog } },
    decision: { kind: 'confirm', id: confirmationId },
  };
}

export function confirmMethodNavigation(
  state: MethodWorkflowState,
  confirmationId: string,
): { state: MethodWorkflowState; target: MethodWorkflowNavigationTarget | null } {
  return state.dialog.kind === 'leave' && state.dialog.id === confirmationId
    ? { state: { ...state, dialog: { kind: 'closed' } }, target: state.dialog.target }
    : { state, target: null };
}
