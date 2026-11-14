import type { ConfigRejectionCode } from './config-rejection.ts';

/** Browser-safe Admin response shapes. Values are produced by authenticated server commands. */
export interface CatalogProduct {
  id: string;
  title: string;
  status: string;
  imageUrl: string | null;
  variants: {
    id: string;
    title: string;
    imageUrl: string | null;
    selectedOptions: { name: string; value: string }[];
  }[];
  configurationSummary?: {
    state: 'not_configured' | 'draft' | 'published';
    methods: string[] | null;
    locations: string[] | null;
  };
  variantsTruncated?: boolean;
  images?: { id: string; url: string; width: number; height: number; alt: string }[];
  imagesTruncated?: boolean;
  options?: { id: string; name: string; values: string[] }[];
  tags?: string[];
  collections?: { id: string; title: string }[];
  collectionsTruncated?: boolean;
  methodSetup?: { methodId: string; locations: number; pricedLocations: number }[];
}

export type PublicationState =
  | 'DRAFT'
  | 'PUBLISH_REQUESTED'
  | 'REMOTE_PENDING'
  | 'REMOTE_READY_ACTIVATION_PENDING'
  | 'ACTIVATION_WAITING_RELEASE'
  | 'ACTIVATION_WAITING_HOLD'
  | 'HELD_ACTIVATION_PENDING'
  | 'ACTIVATED_RESTORATION_PENDING'
  | 'RESTORATION_CONFLICT'
  | 'ACTIVE'
  | 'CONFLICT'
  | 'OPERATOR_HOLD'
  | 'FAILED';

export interface ConfigView {
  product: CatalogProduct;
  config: null | {
    configId: string;
    installationGeneration: string;
    draftVersion: string;
    draft: unknown;
    publishedSetup?: import('@insignia/contracts').SelectedProductSetup | null;
    currentShopCurrency: string | null;
    publication: {
      state: PublicationState;
      revisionId: string | null;
      sourceDraftVersion: string | null;
      requestKey: string | null;
      activeRevisionId?: string | null;
      reason: string | null;
      requiresAllChannelHold: boolean | null;
      functionReadiness: string | null;
    };
    publishEligibility: { allowed: boolean; reason: string | null };
  };
}

export type CommandOutcome =
  | { kind: 'created'; configId: string }
  | { kind: 'saved'; draftVersion: string }
  | { kind: 'accepted'; state: PublicationState; revisionId?: string }
  /** #468: the staff session ended between publication steps; re-send the same request with a
   * session token valid for at least `minimumValidityMs`. */
  | { kind: 'resend'; revisionId?: string; minimumValidityMs: number; message: string }
  | { kind: 'conflict'; message: string }
  | {
      kind: 'invalid';
      /** Stable reason; see config-rejection.ts. */
      code: ConfigRejectionCode;
      noEffect?: true;
      message: string;
      validationIssues?: { path: string; message: string }[];
    }
  | { kind: 'forbidden'; message: string };
