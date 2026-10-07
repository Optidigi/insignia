export { TARGET } from '../m5-015r/documents.mjs';
export const FIXTURE = 'gid://shopify/Product/10495813091611';
export const PUBLICATION = 'gid://shopify/Publication/339456917787';
export const CATALOG = 'gid://shopify/AppCatalog/188090286363';
export const MARKER = 'insignia-m5-015r-746f0a94-9ce4-4679-a324-6647f59c6c0f';
export const CREATED_AT = '2026-10-06T21:27:53Z';
const identity = `shop { id myshopifyDomain plan { partnerDevelopment } }
 currentAppInstallation { id app { id apiKey } accessScopes { handle } }`;
const owned = '__typename id handle title tags createdAt status updatedAt';
const visibility = `publishedAt onlineStoreUrl publishedOnPublication(publicationId:"${PUBLICATION}")
 resourcePublications(first:250, onlyPublished:false) { nodes { isPublished publishDate publication { id } } pageInfo { hasNextPage hasPreviousPage } }
 unpublishedPublications(first:250) { nodes { id } pageInfo { hasNextPage hasPreviousPage } }`;
export const PRESTATE = `query M5016Prestate { ${identity} product(id:"${FIXTURE}") { ${owned} ${visibility} } }`;
export const DIRECT = `query M5016Direct { ${identity} publication(id:"${PUBLICATION}") {
 id autoPublish supportsFuturePublishing catalog { __typename id status }
 includedProducts(first:2, query:"id:10495813091611") { nodes { id } pageInfo { hasNextPage hasPreviousPage } }
 channels(first:2) { nodes { id app { id } } }
} }`;
export const PUBLICATIONS = `query M5016AppPublications($after:String) { ${identity}
 publications(first:50, after:$after, catalogType:APP) { nodes { id autoPublish supportsFuturePublishing catalog { __typename id status } }
 pageInfo { hasNextPage hasPreviousPage endCursor } }
}`;
export const CATALOGS = `query M5016AppCatalogs($after:String) { ${identity}
 catalogs(first:50, after:$after, type:APP) { nodes { __typename id status publication { id } }
 pageInfo { hasNextPage hasPreviousPage endCursor } }
}`;
export const ARCHIVE = `mutation M5016Archive($product:ProductUpdateInput!) {
 productUpdate(product:$product) { product { ${owned} } userErrors { field message } }
}`;
export const FINAL = `query M5016Final { ${identity} product(id:"${FIXTURE}") { ${owned} ${visibility} } }`;
