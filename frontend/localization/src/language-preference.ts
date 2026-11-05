import type { SupportedLanguage } from './core.js';

export type LanguagePreference = SupportedLanguage | null;
interface ActivePreference {
  readonly preference: LanguagePreference;
  readonly revision: number;
}
export type LanguagePreferenceState =
  | (ActivePreference & { readonly status: 'ready' })
  | (ActivePreference & {
      readonly status: 'changing';
      readonly requestedPreference: LanguagePreference;
      readonly source: 'manual' | 'context';
    })
  | (ActivePreference & { readonly status: 'failed' });

export type LanguagePreferenceEvent =
  | { readonly type: 'requested'; readonly revision: number; readonly preference: LanguagePreference }
  | { readonly type: 'contextChanged'; readonly revision: number }
  | { readonly type: 'restored'; readonly revision: number; readonly preference: LanguagePreference }
  | { readonly type: 'activated' | 'failed' | 'cancelled'; readonly revision: number };

export function createLanguagePreferenceState(preference: LanguagePreference = null): LanguagePreferenceState {
  return { status: 'ready', preference, revision: 0 };
}

/** Selection intent is distinct from the preference of the last complete locale snapshot. */
export function selectedLanguagePreference(state: LanguagePreferenceState): LanguagePreference {
  return state.status === 'changing' ? state.requestedPreference : state.preference;
}

/** Pure transitions only. Audience adapters own locale preparation, persistence and callbacks. */
export function languagePreferenceReducer(
  state: LanguagePreferenceState,
  event: LanguagePreferenceEvent,
): LanguagePreferenceState {
  switch (event.type) {
    case 'requested':
      return event.revision > state.revision
        ? {
            status: 'changing',
            preference: state.preference,
            requestedPreference: event.preference,
            source: 'manual',
            revision: event.revision,
          }
        : state;
    case 'contextChanged':
      return event.revision > state.revision
        ? {
            status: 'changing',
            preference: state.preference,
            requestedPreference: selectedLanguagePreference(state),
            source: state.status === 'changing' ? state.source : 'context',
            revision: event.revision,
          }
        : state;
    case 'restored':
      return event.revision > state.revision
        ? { status: 'ready', preference: event.preference, revision: event.revision }
        : state;
    case 'activated':
      return state.status === 'changing' && event.revision === state.revision
        ? { status: 'ready', preference: state.requestedPreference, revision: state.revision }
        : state;
    case 'failed':
      return state.status === 'changing' && event.revision === state.revision
        ? { status: 'failed', preference: state.preference, revision: state.revision }
        : state;
    case 'cancelled':
      return state.status === 'changing' && event.revision === state.revision
        ? { status: 'ready', preference: state.preference, revision: state.revision }
        : state;
  }
}
