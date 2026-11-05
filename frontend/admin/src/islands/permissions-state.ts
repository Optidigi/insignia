export type PermissionStatus =
  | 'allow-product-setup'
  | 'product-setup-needed'
  | 'checkout-setup-needed'
  | 'allow-checkout-checks'
  | 'access-checked'
  | 'checkout-declined'
  | 'product-declined'
  | 'check-failed'
  | 'checkout-result-unknown'
  | 'product-result-unknown';
export type PermissionOperation = 'check' | 'checkout-consent' | 'product-consent';
export type PermissionNeeds = { checkout: string[]; product: string[] };
export type PermissionState = {
  phase: 'idle' | 'checking' | 'requesting' | 'ready' | 'failed';
  attempt: number;
  operation: PermissionOperation;
  missing: string[];
  missingProduct: string[];
  status: PermissionStatus | null;
  access: { canRead: boolean; canEdit: boolean } | null;
  setupAccess: boolean | null;
  orderAccess: boolean | null;
  productAccess: { canWriteProducts: boolean; canReadPublications: boolean } | null;
};
export type PermissionEvent =
  | { type: 'operation-started'; attempt: number; operation: PermissionOperation }
  | { type: 'scopes-observed'; attempt: number; needs: PermissionNeeds; granted: string[] }
  | { type: 'access-observed'; attempt: number; access: { canRead: boolean; canEdit: boolean } }
  | { type: 'verification-finished'; attempt: number; needs: PermissionNeeds }
  | { type: 'consent-declined'; attempt: number }
  | { type: 'verification-failed'; attempt: number; refused: boolean };
export function initialPermissionState(): PermissionState {
  return {
    phase: 'idle',
    attempt: 0,
    operation: 'check',
    missing: [],
    missingProduct: [],
    status: null,
    access: null,
    setupAccess: null,
    orderAccess: null,
    productAccess: null,
  };
}
export function permissionReducer(state: PermissionState, event: PermissionEvent): PermissionState {
  if (event.type === 'operation-started') {
    if (event.attempt <= state.attempt) return state;
    return {
      ...initialPermissionState(),
      attempt: event.attempt,
      operation: event.operation,
      phase: event.operation === 'check' ? 'checking' : 'requesting',
    };
  }
  if (event.attempt !== state.attempt || (state.phase !== 'checking' && state.phase !== 'requesting')) return state;
  switch (event.type) {
    case 'scopes-observed':
      return {
        ...state,
        missing: event.needs.checkout,
        missingProduct: event.needs.product,
        setupAccess: event.needs.checkout.length === 0,
        orderAccess: event.granted.includes('read_orders'),
        productAccess: {
          canWriteProducts: event.granted.includes('write_products'),
          canReadPublications: event.granted.includes('read_publications'),
        },
      };
    case 'access-observed':
      return { ...state, access: event.access };
    case 'verification-finished': {
      const status = event.needs.product.includes('write_products')
        ? state.operation === 'check'
          ? 'allow-product-setup'
          : 'product-setup-needed'
        : event.needs.checkout.length
          ? state.operation === 'checkout-consent'
            ? 'checkout-setup-needed'
            : 'allow-checkout-checks'
          : 'access-checked';
      return { ...state, phase: 'ready', status };
    }
    case 'consent-declined':
      return {
        ...state,
        phase: 'ready',
        setupAccess: state.operation === 'checkout-consent' ? false : null,
        status: state.operation === 'checkout-consent' ? 'checkout-declined' : 'product-declined',
      };
    case 'verification-failed':
      return {
        ...state,
        phase: event.refused ? 'idle' : 'failed',
        status: event.refused
          ? null
          : state.operation === 'check'
            ? 'check-failed'
            : state.operation === 'checkout-consent'
              ? 'checkout-result-unknown'
              : 'product-result-unknown',
      };
  }
}
