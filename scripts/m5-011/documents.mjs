import { ADAPTER_READ, ADAPTER_UPDATE, IDENTITY, PRODUCT_FIELDS, TARGET } from '../m5-004/operator.mjs';

export { ADAPTER_READ, ADAPTER_UPDATE, IDENTITY, TARGET };
export const FIXTURE = 'gid://shopify/Product/10490211467547';
export const MARKER = 'insignia-m5-010-503f5c3d-a0d5-4c67-b2ef-5e22ad3f31bb';
export const PUBLICATION_ID = 'gid://shopify/Publication/339456917787';
export const CREATED_AT = '2026-10-02T21:19:48Z';
export const PARTITIONS = ['APP', 'MARKET', 'COMPANY_LOCATION', 'NONE'];
const ownFields = '__typename id handle title tags createdAt status updatedAt publishedAt onlineStoreUrl';
const identityFields = `shop { id myshopifyDomain plan { partnerDevelopment displayName } }
  currentAppInstallation { id app { id apiKey } accessScopes { handle } }`;
export const V2_DOCUMENTS = Object.fromEntries(
  PARTITIONS.map((type) => [
    type,
    `query M5011V2${type}($id: ID!) { ${identityFields} product(id:$id) { ${ownFields}
  ${type}: resourcePublicationsV2(first:250, onlyPublished:false, catalogType:${type}) {
  nodes { isPublished publishDate publication { id } }
  pageInfo { hasNextPage hasPreviousPage }
} } }`,
  ]),
);
export const PROJECTION = `query M5011Projection($id: ID!) {
  shop { id myshopifyDomain plan { partnerDevelopment displayName } }
  currentAppInstallation { id app { id apiKey } accessScopes { handle } }
  product(id:$id) { ${PRODUCT_FIELDS} handle title tags createdAt }
}`;
export const PUBLICATION = `query M5011Publication($id: ID!) {
  publication(id:$id) {
    id autoPublish supportsFuturePublishing
    catalog { __typename id title status }
    channels(first:50) {
      nodes { id name app { id title } }
      pageInfo { hasNextPage hasPreviousPage }
    }
  }
}`;
export const ARCHIVE = `mutation M5011Archive($product: ProductUpdateInput!) {
  productUpdate(product:$product) {
    product { ${PRODUCT_FIELDS} handle title tags createdAt }
    userErrors { field message }
  }
}`;
