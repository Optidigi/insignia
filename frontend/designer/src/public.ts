/** Public Designer API. Kept free of style imports so the published declarations need no CSS module support. */
export { Designer, type DesignerProps } from './designer';
export { configSchema, type ProductConfig } from './config';
export type { Artwork, Design, Print } from './model';
export type { DesignerPorts, CartRequest, CartReceipt, UploadRequest } from './runtime';
export { buildShopifyVariantMatrix } from './shopify-variant-matrix';
