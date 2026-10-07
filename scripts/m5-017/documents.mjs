// Only fixture bookkeeping documents. Availability documents are captured from
// the frozen production source; no snapshot/hold behavior is implemented here.
import { readFileSync } from 'node:fs';
import { requireValue } from '../m5-011/operator.mjs';
export const TARGET = Object.freeze({
  app: 'gid://shopify/App/429028933633',
  client: '1443cf6d03d39edae7c101a943c5c684',
  domain: 'insignia-rewrite-dev.myshopify.com',
  shop: 'gid://shopify/Shop/105501393179',
  installation: 'gid://shopify/AppInstallation/1054356963611',
});
export const SCOPE = Object.freeze({
  shopId: 'm5_017_fixture_only',
  installationGeneration: '1',
  shopifyShopId: TARGET.shop,
  appClientId: TARGET.client,
});
const identity =
  'shop { id myshopifyDomain plan { partnerDevelopment } } currentAppInstallation { id app { id apiKey } accessScopes { handle } }';
const owned = '__typename id handle title tags createdAt status updatedAt';
export const IDENTITY = `query M5017Identity { ${identity} }`;
export const OWNED = `query M5017Owned($id: ID!) { ${identity} product(id:$id) { ${owned} } }`;
export const CREATE = `mutation M5017Create($product:ProductCreateInput!) { productCreate(product:$product) { product { ${owned} } userErrors { field message } } }`;
export const STATUS = `mutation M5017Status($product:ProductUpdateInput!) { productUpdate(product:$product) { product { ${owned} } userErrors { field message } } }`;
export function productionDocuments(root) {
  const source = readFileSync(`${root}/packages/shopify/src/availability-hold-v3.ts`, 'utf8');
  const extract = (name) => {
    const found = source.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`));
    requireValue(found, 'production_document_source');
    return found[1];
  };
  const fields = extract('PRODUCT_FIELDS');
  const identity = extract('IDENTITY');
  const read = extract('READ').replace(`\${PRODUCT_FIELDS}`, fields).replace(`\${IDENTITY}`, identity);
  const anchor = extract('ANCHOR').replace(`\${IDENTITY}`, identity);
  const update = extract('UPDATE').replace(`\${PRODUCT_FIELDS}`, fields);
  requireValue(!read.includes('${') && !update.includes('${'), 'production_document_interpolation');
  requireValue(!anchor.includes('${'), 'production_document_interpolation');
  return { read, update, anchor };
}
