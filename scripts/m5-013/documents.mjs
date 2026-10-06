import { TARGET } from '../m5-004/operator.mjs';

export { CREATED_AT, FIXTURE, MARKER, PUBLICATION_ID } from '../m5-011/documents.mjs';
export { TARGET };
export const IDENTITY_FIELDS = `shop { id myshopifyDomain plan { partnerDevelopment displayName } }
currentAppInstallation { id app { id apiKey } accessScopes { handle } }`;
export const PRODUCT_FIELDS = `__typename id handle title tags createdAt status updatedAt publishedAt onlineStoreUrl
publishedOnPublication(publicationId:"gid://shopify/Publication/339456917787")
resourcePublications(first:2) { nodes { isPublished publishDate publication { id } } pageInfo { hasNextPage hasPreviousPage } }`;
const projection = `${IDENTITY_FIELDS} product(id:"gid://shopify/Product/10490211467547") { ${PRODUCT_FIELDS} }`;
export const PRESTATE = `query M5013Prestate { ${projection} }`;
export const FINAL = `query M5013Final { ${projection} }`;
export const ARCHIVE = `mutation M5013Archive($product: ProductUpdateInput!) {
productUpdate(product:$product) { product { ${PRODUCT_FIELDS} } userErrors { field message } }
}`;
