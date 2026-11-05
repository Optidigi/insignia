/** Presentation state stays separate from persisted wording and its save transaction. */
export type TranslationEditorState = Readonly<{
  section: string;
  query: string;
  matchingKeys: readonly string[] | null;
  page: number;
  locale: string | null;
  /** Pinned until save/discard or context change, so clearing a field cannot remove it mid-edit. */
  customizedKeys: readonly string[];
}>;
export type TranslationEditorEvent =
  | { type: 'section-opened'; section: string; customizedKeys: readonly string[] }
  | { type: 'query-edited'; query: string; matchingKeys: readonly string[] }
  | { type: 'page-selected'; page: number }
  | { type: 'snapshot-accepted'; locale: string; customizedKeys: readonly string[]; matchingKeys?: readonly string[] };

export function initialTranslationEditorState(section: string): TranslationEditorState {
  return { section, query: '', matchingKeys: null, page: 0, locale: null, customizedKeys: [] };
}

export function translationEditorReducer(
  state: TranslationEditorState,
  event: TranslationEditorEvent,
): TranslationEditorState {
  switch (event.type) {
    case 'section-opened':
      return {
        ...state,
        section: event.section,
        query: '',
        matchingKeys: null,
        page: 0,
        customizedKeys: [...event.customizedKeys],
      };
    case 'query-edited':
      return {
        ...state,
        query: event.query,
        page: 0,
        matchingKeys: event.query.trim() ? [...event.matchingKeys] : null,
      };
    case 'page-selected':
      return { ...state, page: Math.max(0, event.page) };
    case 'snapshot-accepted':
      return {
        ...state,
        matchingKeys:
          state.locale !== null && state.locale !== event.locale ? null : (event.matchingKeys ?? state.matchingKeys),
        locale: event.locale,
        customizedKeys: [...event.customizedKeys],
        page: 0,
        query: state.locale !== null && state.locale !== event.locale ? '' : state.query,
      };
  }
}
