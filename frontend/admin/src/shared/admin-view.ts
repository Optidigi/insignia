/** Browser-safe Admin response shapes. Values are produced by authenticated server commands. */
import type { ConfigRejectionCode } from '../../../../apps/web/src/shared/config-rejection.ts';

export type ProductConfigurationSummary = {
  state: 'not_configured' | 'draft' | 'published';
  methods: string[] | null;
  locations: string[] | null;
};

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
  variantsTruncated?: boolean;
  images?: { id: string; url: string; width: number; height: number; alt: string }[];
  imagesTruncated?: boolean;
  options?: { id: string; name: string; values: string[] }[];
  tags?: string[];
  collections?: { id: string; title: string }[];
  collectionsTruncated?: boolean;
  methodSetup?: { methodId: string; locations: number; pricedLocations: number }[];
  configurationSummary?: ProductConfigurationSummary;
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
  | { kind: 'continue'; revisionId?: string; minimumValidityMs: number; message: string }
  | { kind: 'conflict'; message: string }
  | {
      kind: 'invalid';
      /** Stable reason; see apps/web/src/shared/config-rejection.ts. */
      code: ConfigRejectionCode;
      noEffect?: true;
      message: string;
      validationIssues?: { path: string; message: string }[];
    }
  | { kind: 'forbidden'; message: string };
