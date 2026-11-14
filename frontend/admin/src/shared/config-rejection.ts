import type { AdminLocaleSnapshot } from '@insignia/ui-localization/admin';
import {
  CONFIG_REJECTION_CODES,
  type ConfigRejectionCode,
} from '../../../../apps/web/src/shared/config-rejection.ts';

type Translate = AdminLocaleSnapshot['t'];

/**
 * A 422 from the product configuration route: the server read the request and refused it.
 * Retrying the same request is refused again, so this is never a lost or unconfirmed write.
 * `code` is null for a code this page does not know (for example from a newer server).
 */
export interface ConfigRejection {
  code: ConfigRejectionCode | null;
  /** The server's own reason: its first field issue when it lists one, else its message. */
  reason: string;
  /** The field the server named, when it named one. */
  path: string | null;
}

/** These rejections come from state that moved after the draft was made: only a reload recovers. */
const needsReload = new Set<ConfigRejectionCode>([
  'SHOP_CURRENCY_CHANGED',
  'METHOD_LINKS_CHANGED',
  'PRODUCT_IDENTITY_CHANGED',
  'MEDIA_URL_NOT_CANONICAL',
]);

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Reads the error the request boundary throws for a non-OK response (status, code, validationIssues). */
export function configRejectionFrom(error: unknown): ConfigRejection | null {
  if (!error || typeof error !== 'object' || !('status' in error) || error.status !== 422) return null;
  const sent = 'code' in error ? text(error.code) : '';
  const issue = 'validationIssues' in error && Array.isArray(error.validationIssues) ? error.validationIssues[0] : null;
  const issueObject = issue && typeof issue === 'object' ? issue : {};
  return {
    code: CONFIG_REJECTION_CODES.find((code) => code === sent) ?? null,
    reason: ('message' in issueObject ? text(issueObject.message) : '') || ('message' in error ? text(error.message) : ''),
    path: ('path' in issueObject ? text(issueObject.path) : '') || null,
  };
}

/** The kind of item a draft field path points into; the raw path is internal and never shown. */
function invalidItem(path: string | null): 'view' | 'placement' | 'size' | 'method' | 'price' | 'other' {
  for (const part of (path ?? '').split('.').reverse()) {
    if (part === 'prices' || part === 'pricingRules' || part === 'amount') return 'price';
    if (part === 'sizes') return 'size';
    if (part === 'placements') return 'placement';
    if (part === 'views') return 'view';
    if (part === 'methods' || part === 'methodBindings') return 'method';
  }
  return 'other';
}

/** True when saving again cannot help until the merchant reloads the saved draft. */
export const configRejectionNeedsReload = (rejection: ConfigRejection): boolean =>
  rejection.code !== null && needsReload.has(rejection.code);

/** Merchant-readable wording for a rejection, rendered in the current language. */
export function configRejectionText(rejection: ConfigRejection, t: Translate): string {
  const generic = () => t('editor:placementWorkflowPreview.configRejection.generic', { reason: rejection.reason });
  switch (rejection.code) {
    case 'DRAFT_SCHEMA_INVALID':
      return t(`editor:placementWorkflowPreview.configRejection.draftSchemaInvalid.${invalidItem(rejection.path)}`);
    case 'SETUP_CAPACITY_EXCEEDED':
      return t('editor:placementWorkflowPreview.realCapacityExceeded');
    case 'SETUP_MEDIA_NOT_OWNED':
      return t('editor:placementWorkflowPreview.configRejection.mediaNotOwned');
    case 'SETUP_SIZE_INVALID':
      return t('editor:placementWorkflowPreview.configRejection.sizeInvalid');
    case 'PRICE_AMOUNT_INVALID':
      return t('editor:placementWorkflowPreview.configRejection.priceAmountInvalid');
    case 'LEAN_PRICING_INVALID':
      return t('editor:placementWorkflowPreview.configRejection.leanPricingInvalid');
    case 'GEOMETRY_INVALID':
      return t('editor:placementWorkflowPreview.configRejection.geometryInvalid');
    case 'SHOP_CURRENCY_CHANGED':
      return t('editor:placementWorkflowPreview.configRejection.shopCurrencyChanged');
    case 'METHOD_LINKS_CHANGED':
      return t('editor:placementWorkflowPreview.configRejection.methodLinksChanged');
    case 'PRODUCT_IDENTITY_CHANGED':
      return t('editor:placementWorkflowPreview.configRejection.productIdentityChanged');
    case 'MEDIA_URL_NOT_CANONICAL':
      return t('editor:placementWorkflowPreview.configRejection.mediaUrlNotCanonical');
    case 'PUBLICATION_INCOMPLETE':
      return t('editor:placementWorkflowPreview.configRejection.publicationIncomplete', { reason: rejection.reason });
    // Codes a merchant cannot act on by themselves, or that only a client defect can cause, keep the server's reason.
    case 'IDEMPOTENCY_KEY_REQUIRED':
    case 'INVALID_COMMAND':
    case 'INVALID_RECONCILIATION_IDENTITY':
    case 'SETUP_IDENTITY_INVALID':
    case 'SETUP_METHOD_UNKNOWN':
    case 'SETUP_CURRENCY_UNSUPPORTED':
    case 'CONFIG_POLICY_INVALID':
    case 'LABEL_REFERENCE_INVALID':
    case 'DRAFT_INVALID':
    case 'REQUIRED_MODE_REQUIRED':
    case 'PRODUCTION_DIMENSIONS_REQUIRED':
    case 'METHOD_REVIEW_REQUIRED':
    case 'COPY_TARGET_SAME':
    case 'COPY_SOURCE_MISSING':
    case 'COPY_SOURCE_NEEDS_REVIEW':
    case 'COPY_LEAN_REVIEW_REQUIRED':
    case null:
      return generic();
    default: {
      const unhandled: never = rejection.code;
      return unhandled;
    }
  }
}
