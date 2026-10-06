import { TARGET } from '../m5-004/operator.mjs';

export { CREATED_AT, FIXTURE, MARKER, PUBLICATION_ID } from '../m5-011/documents.mjs';
export { TARGET };
export const LAST_DRAFT_VERSION = '2026-10-06T13:09:52Z';
export const CHANNEL_ID = 'gid://shopify/Channel/339456917787';
export const CHANNEL_APP = 'gid://shopify/App/294412484609';
export const IDENTITY_FIELDS = `shop { id myshopifyDomain plan { partnerDevelopment displayName } }
currentAppInstallation { id app { id apiKey } accessScopes { handle } }`;
export const OWN_FIELDS = '__typename id handle title tags createdAt status updatedAt';
export const PRODUCT_FIELDS = `${OWN_FIELDS} publishedAt onlineStoreUrl
publishedOnPublication(publicationId:"gid://shopify/Publication/339456917787")
resourcePublications(first:2) { nodes { isPublished publishDate publication { id } } pageInfo { hasNextPage hasPreviousPage } }`;
const anchor = `product(id:"gid://shopify/Product/10490211467547") { ${PRODUCT_FIELDS} }`;
export const IDENTITY = `query M5012Identity { ${IDENTITY_FIELDS} }`;
export const PROJECTION = `query M5012Projection { ${IDENTITY_FIELDS} ${anchor} }`;
export const PUBLICATION = `query M5012Publication { ${IDENTITY_FIELDS} ${anchor}
publication(id:"gid://shopify/Publication/339456917787") {
id autoPublish supportsFuturePublishing catalog { __typename id title status }
channels(first:2) { nodes { id name app { id title } } pageInfo { hasNextPage hasPreviousPage } }
} }`;
export const INCLUDED = `query M5012Included { ${IDENTITY_FIELDS} ${anchor}
publication(id:"gid://shopify/Publication/339456917787") {
id includedProducts(first:2, query:"id:10490211467547") { nodes { ${OWN_FIELDS} } pageInfo { hasNextPage hasPreviousPage } }
} }`;
export const SEARCH_STRINGS = Object.freeze({
  app: 'id:10490211467547 published_status:294412484609-intended',
  channel: 'id:10490211467547 published_status:339456917787-intended',
  association: "id:10490211467547 publication_ids:'339456917787'",
});
export const SEARCHES = Object.freeze(
  Object.fromEntries(
    Object.entries(SEARCH_STRINGS).map(([name, search]) => [
      name,
      `query M5012Search${name} { ${IDENTITY_FIELDS} ${anchor}
products(first:2, query:"${search}") { nodes { ${OWN_FIELDS} } pageInfo { hasNextPage hasPreviousPage } }
}`,
    ]),
  ),
);
export const ARCHIVE = `mutation M5012Archive($product: ProductUpdateInput!) {
productUpdate(product:$product) { product { ${PRODUCT_FIELDS} } userErrors { field message } }
}`;
export const READS = Object.freeze({
  identity: IDENTITY,
  projection: PROJECTION,
  publication: PUBLICATION,
  included: INCLUDED,
  ...SEARCHES,
});
