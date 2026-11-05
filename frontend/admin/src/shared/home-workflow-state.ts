import { type HomeGuidanceStepId, type HomePanel, homeGuidanceStepIds } from './merchant-home.ts';

export type HomeGuidanceState = {
  loaded: boolean;
  dismissed: boolean;
  completedSteps: HomeGuidanceStepId[];
};
export type HomeGuidanceEvent =
  | { type: 'preferences-loaded'; dismissed: boolean; completedSteps: HomeGuidanceStepId[] }
  | { type: 'guide-dismissed' }
  | { type: 'guide-restored' }
  | { type: 'step-acknowledged'; step: HomeGuidanceStepId; complete: boolean };
export function initialHomeGuidanceState(): HomeGuidanceState {
  return { loaded: false, dismissed: false, completedSteps: [] };
}
export function homeGuidanceReducer(state: HomeGuidanceState, event: HomeGuidanceEvent): HomeGuidanceState {
  if (event.type === 'preferences-loaded')
    return {
      loaded: true,
      dismissed: event.dismissed,
      completedSteps: homeGuidanceStepIds.filter((id) => event.completedSteps.includes(id)),
    };
  if (!state.loaded) return state;
  if (event.type === 'guide-dismissed' || event.type === 'guide-restored')
    return { ...state, dismissed: event.type === 'guide-dismissed' };
  return {
    ...state,
    completedSteps: homeGuidanceStepIds.filter((id) =>
      id === event.step ? event.complete : state.completedSteps.includes(id),
    ),
  };
}

export type HomeActionState = { retrying: HomePanel | null; creation: 'idle' | 'pending' | 'failed' };
export type HomeActionEvent =
  | { type: 'panel-retry-requested' | 'panel-retry-finished'; panel: HomePanel }
  | { type: 'product-creation-requested' | 'product-created' | 'product-creation-failed' };
export function initialHomeActionState(): HomeActionState {
  return { retrying: null, creation: 'idle' };
}
export function homeActionReducer(state: HomeActionState, event: HomeActionEvent): HomeActionState {
  switch (event.type) {
    case 'panel-retry-requested':
      return state.retrying === null ? { ...state, retrying: event.panel } : state;
    case 'panel-retry-finished':
      return state.retrying === event.panel ? { ...state, retrying: null } : state;
    case 'product-creation-requested':
      return state.creation === 'pending' ? state : { ...state, creation: 'pending' };
    case 'product-created':
      return state.creation === 'pending' ? { ...state, creation: 'idle' } : state;
    case 'product-creation-failed':
      return state.creation === 'pending' ? { ...state, creation: 'failed' } : state;
  }
}
