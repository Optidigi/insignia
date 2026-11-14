/**
 * Stable reason codes carried as `code` on every 422 from the product configuration route
 * (`/api/admin/products/:id/config`). A 422 is a rejection, never a lost request: retrying
 * the same request returns the same code. Messages may change; these codes do not.
 */
export const CONFIG_REJECTION_CODES = [
  // Request shape (the admin client sent a malformed command).
  'IDEMPOTENCY_KEY_REQUIRED',
  'INVALID_COMMAND',
  'INVALID_RECONCILIATION_IDENTITY',
  'MEDIA_URL_NOT_CANONICAL',
  // Draft content (save and publish validate the same draft rules).
  'DRAFT_SCHEMA_INVALID',
  'PRODUCT_IDENTITY_CHANGED',
  'SETUP_CAPACITY_EXCEEDED',
  'SETUP_MEDIA_NOT_OWNED',
  'SETUP_IDENTITY_INVALID',
  'SETUP_SIZE_INVALID',
  'SETUP_METHOD_UNKNOWN',
  'SETUP_CURRENCY_UNSUPPORTED',
  'PRICE_AMOUNT_INVALID',
  'LEAN_PRICING_INVALID',
  'GEOMETRY_INVALID',
  'CONFIG_POLICY_INVALID',
  'LABEL_REFERENCE_INVALID',
  'DRAFT_INVALID',
  // Current state changed or does not allow the command.
  'REQUIRED_MODE_REQUIRED',
  'SHOP_CURRENCY_CHANGED',
  'METHOD_LINKS_CHANGED',
  // Publication readiness.
  'PUBLICATION_INCOMPLETE',
  'PRODUCTION_DIMENSIONS_REQUIRED',
  'METHOD_REVIEW_REQUIRED',
] as const;
export type ConfigRejectionCode = (typeof CONFIG_REJECTION_CODES)[number];
