import { describe, expect, it } from 'vitest';
import { createLanguagePreferenceState, languagePreferenceReducer, selectedLanguagePreference } from './core.js';

describe('language preference transitions', () => {
  it('keeps the last active preference when a requested change fails', () => {
    const ready = createLanguagePreferenceState('nl');
    const changing = languagePreferenceReducer(ready, { type: 'requested', revision: 1, preference: 'de' });
    expect(changing.status).toBe('changing');
    expect(selectedLanguagePreference(changing)).toBe('de');
    const failed = languagePreferenceReducer(changing, { type: 'failed', revision: 1 });
    expect(failed.status).toBe('failed');
    expect(selectedLanguagePreference(failed)).toBe('nl');
  });
});

it('ignores out-of-order completion when returning to the active language', () => {
  let state = createLanguagePreferenceState('en');
  state = languagePreferenceReducer(state, { type: 'requested', revision: 1, preference: 'de' });
  state = languagePreferenceReducer(state, { type: 'requested', revision: 2, preference: 'en' });
  const pending = state;
  expect(languagePreferenceReducer(state, { type: 'activated', revision: 1 })).toBe(pending);
  state = languagePreferenceReducer(state, { type: 'activated', revision: 2 });
  expect(state).toMatchObject({ status: 'ready', preference: 'en', revision: 2 });
});

it('retains pending manual intent across a host-language or wording refresh', () => {
  let state = createLanguagePreferenceState(null);
  state = languagePreferenceReducer(state, { type: 'requested', revision: 1, preference: 'fr' });
  state = languagePreferenceReducer(state, { type: 'contextChanged', revision: 2 });
  expect(state).toMatchObject({ status: 'changing', preference: null, requestedPreference: 'fr', source: 'manual' });
  expect(languagePreferenceReducer(state, { type: 'activated', revision: 1 })).toBe(state);
  state = languagePreferenceReducer(state, { type: 'activated', revision: 2 });
  expect(state).toMatchObject({ status: 'ready', preference: 'fr' });
});

it('an automatic reset can commit even when its effective language has not changed', () => {
  let state = createLanguagePreferenceState('nl');
  state = languagePreferenceReducer(state, { type: 'requested', revision: 1, preference: null });
  expect(selectedLanguagePreference(state)).toBeNull();
  state = languagePreferenceReducer(state, { type: 'activated', revision: 1 });
  expect(state).toMatchObject({ status: 'ready', preference: null });
});

it('external restoration invalidates a prior request and context failure preserves the active preference', () => {
  let state = createLanguagePreferenceState('nl');
  state = languagePreferenceReducer(state, { type: 'requested', revision: 1, preference: 'de' });
  state = languagePreferenceReducer(state, { type: 'restored', revision: 2, preference: 'it' });
  expect(languagePreferenceReducer(state, { type: 'activated', revision: 1 })).toBe(state);
  state = languagePreferenceReducer(state, { type: 'contextChanged', revision: 3 });
  expect(state).toMatchObject({ source: 'context', requestedPreference: 'it' });
  state = languagePreferenceReducer(state, { type: 'failed', revision: 3 });
  expect(state).toMatchObject({ status: 'failed', preference: 'it' });
});
