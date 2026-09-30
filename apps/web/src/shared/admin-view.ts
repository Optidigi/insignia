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
  variantsTruncated?: boolean;
}

export type PublicationState =
  | 'DRAFT'
  | 'PUBLISH_REQUESTED'
  | 'REMOTE_PENDING'
  | 'REMOTE_READY_ACTIVATION_PENDING'
  | 'ACTIVE'
  | 'CONFLICT'
  | 'OPERATOR_HOLD';

export interface ConfigView {
  product: CatalogProduct;
  config: null | {
    configId: string;
    draftVersion: string;
    draft: unknown;
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
  | { kind: 'conflict'; message: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'forbidden'; message: string };
