import {
  AVAILABILITY_V2_PUBLICATION_ITEM_LIMIT,
  AVAILABILITY_V2_PUBLICATION_PAGE_LIMIT,
} from '../../packages/shopify/dist/index.js';
import { CATALOG, PUBLICATION } from './documents.mjs';
import { requireValue } from './operator.mjs';
import { gid, validateCatalog, validatePublication } from './projections.mjs';
export async function enumerate(op, request, query, name, reserve) {
  const result = { complete: false, nodes: [], pages: [], failure: null };
  const seen = new Set(),
    cursors = new Set();
  let after = null;
  try {
    for (let n = 0; n < AVAILABILITY_V2_PUBLICATION_PAGE_LIMIT; n++) {
      requireValue(op.state().counts.graphql < 16 - reserve, 'discovery_budget');
      op.mode(name);
      const data = await request(query, { after });
      const c = data[name],
        page = c?.pageInfo;
      result.pages.push(c);
      requireValue(
        Array.isArray(c?.nodes) &&
          c.nodes.length <= 50 &&
          typeof page?.hasNextPage === 'boolean' &&
          typeof page.hasPreviousPage === 'boolean' &&
          (n !== 0 || page.hasPreviousPage === false),
        'discovery_page',
      );
      for (const node of c.nodes) {
        if (name === 'publications') validatePublication(node);
        else {
          requireValue(node !== null, 'catalog_shape');
          validateCatalog(node, true);
          requireValue(node.publication === null || gid('Publication', node.publication?.id), 'catalog_publication');
        }
        requireValue(!seen.has(node.id), 'duplicate_discovery_id');
        seen.add(node.id);
        requireValue(seen.size <= AVAILABILITY_V2_PUBLICATION_ITEM_LIMIT, 'discovery_items');
        result.nodes.push(node);
      }
      if (!page.hasNextPage) {
        result.complete = true;
        return result;
      }
      requireValue(c.nodes.length > 0, 'empty_discovery_page');
      requireValue(
        typeof page.endCursor === 'string' &&
          page.endCursor.length > 0 &&
          page.endCursor.length <= 2048 &&
          !cursors.has(page.endCursor),
        'discovery_cursor',
      );
      cursors.add(page.endCursor);
      after = page.endCursor;
    }
    throw new Error('discovery_page_limit');
  } catch (error) {
    result.failure = error.kind ?? 'discovery_page_limit';
    const event = op.state().events.at(-1);
    const partial = event?.failure === 'provider_error' && event.response?.data?.[name];
    if (partial) result.pages.push(partial);
  }
  return result;
}
export function classify(direct, publications, catalogs) {
  const p = publications.nodes.find((n) => n.id === PUBLICATION);
  const matches = catalogs.nodes.filter((n) => n.publication?.id === PUBLICATION);
  const c = matches[0];
  const historicalCatalog = catalogs.nodes.find((n) => n.id === CATALOG);
  const pubConsistent =
    !!p &&
    p.autoPublish === direct.publication?.autoPublish &&
    p.supportsFuturePublishing === direct.publication?.supportsFuturePublishing &&
    JSON.stringify(p.catalog) === JSON.stringify(direct.publication?.catalog);
  const catConsistent =
    !!c &&
    JSON.stringify({ __typename: c.__typename, id: c.id, status: c.status }) ===
      JSON.stringify(direct.publication?.catalog);
  const observedPublications = publications.pages.flatMap((page) => (Array.isArray(page?.nodes) ? page.nodes : []));
  const observedCatalogs = catalogs.pages.flatMap((page) => (Array.isArray(page?.nodes) ? page.nodes : []));
  const expectedCatalog = JSON.stringify(direct.publication?.catalog);
  const structuralFailure = (result) =>
    result.failure !== null && !['provider_error', 'discovery_budget', 'NOT_RUN'].includes(result.failure);
  const ambiguity =
    structuralFailure(publications) ||
    structuralFailure(catalogs) ||
    observedPublications.some(
      (node) =>
        node?.id === PUBLICATION &&
        (node.autoPublish !== direct.publication?.autoPublish ||
          node.supportsFuturePublishing !== direct.publication?.supportsFuturePublishing ||
          JSON.stringify(node.catalog) !== expectedCatalog),
    ) ||
    observedCatalogs.some(
      (node) =>
        (node?.publication?.id === PUBLICATION &&
          JSON.stringify({ __typename: node.__typename, id: node.id, status: node.status }) !== expectedCatalog) ||
        (node?.id === CATALOG && node.publication?.id !== PUBLICATION),
    ) ||
    new Set(observedCatalogs.filter((node) => node?.publication?.id === PUBLICATION).map((node) => node.id)).size > 1 ||
    matches.length > 1 ||
    (p && !pubConsistent) ||
    (c && !catConsistent) ||
    (historicalCatalog && historicalCatalog.publication?.id !== PUBLICATION);
  const generic = (publications.complete && pubConsistent) || (catalogs.complete && catConsistent);
  return {
    classification:
      !direct.confirmed || ambiguity
        ? 'UNRESOLVED'
        : generic
          ? 'GENERIC_DISCOVERY_CONFIRMED'
          : publications.complete && catalogs.complete
            ? 'DIRECT_ONLY'
            : 'UNRESOLVED',
    explicitAppPublicationTarget: !!p,
    appCatalogPublicationTarget: !!c,
    historicalAppCatalogPresent: !!historicalCatalog,
    ambiguity: !!ambiguity,
    provenSurface:
      direct.confirmed && !ambiguity && generic
        ? publications.complete && pubConsistent
          ? 'publications(catalogType:APP)'
          : 'catalogs(type:APP)'
        : null,
  };
}
