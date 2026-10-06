import { assertOwned, FIND, FIXTURE, requireValue, SETUP } from '../m5-004/operator.mjs';

export const PREDECESSOR = Object.freeze({
  marker: 'insignia-m5-009-439c9699-af2f-4e8a-b0f1-89003b88a2d4',
  createdAt: '2026-10-02T19:57:53.469Z',
});
export const initialPredecessor = () => ({
  ...PREDECESSOR,
  resolution: 'PENDING',
  fixture: null,
  fixtureIdentity: null,
  status: null,
  observedAt: null,
  failure: null,
});
export const isRecovery = (event) => event.operation.startsWith('predecessor_');
export function predecessorRequest(current, operation) {
  if (operation === 'predecessor_lookup') return { query: FIND, variables: { search: `handle:${PREDECESSOR.marker}` } };
  if (operation === 'predecessor_archive')
    return { query: SETUP, variables: { product: { id: current.fixture, status: 'ARCHIVED' } } };
  requireValue(operation === 'predecessor_readback', 'predecessor_operation');
  return { query: FIXTURE, variables: { id: current.fixture } };
}
function owned(product, current) {
  assertOwned(product, {
    run: PREDECESSOR.marker,
    createdAt: PREDECESSOR.createdAt,
    fixtureIdentity: current.fixtureIdentity,
  });
  if (current.fixture) requireValue(product.id === current.fixture, 'predecessor_identity');
}
// Derived only from retained responses, both at dispatch and when reopening the register.
export function observePredecessor(current, event) {
  const next = structuredClone(current);
  try {
    requireValue(
      event.result === (event.operation === 'predecessor_archive' ? 'ACKNOWLEDGED' : 'RESPONDED') &&
        event.httpStatus === 200 &&
        event.bodyObservation === 'COMPLETE_BODY' &&
        event.replayKind === 'JSON' &&
        event.response &&
        !Object.hasOwn(event.response, 'errors') &&
        event.response.data,
      'predecessor_response',
    );
    let product;
    if (event.operation === 'predecessor_lookup') {
      const connection = event.response.data.products;
      requireValue(
        current.resolution === 'PENDING' &&
          event.kind === 'read' &&
          Array.isArray(connection?.nodes) &&
          connection.nodes.length <= 1 &&
          connection.pageInfo?.hasNextPage === false &&
          connection.pageInfo.hasPreviousPage === false,
        'predecessor_lookup_ambiguous',
      );
      if (connection.nodes.length === 0) next.resolution = 'ABSENT';
      else {
        product = connection.nodes[0];
        owned(product, current);
        next.fixture = product.id;
        next.fixtureIdentity = {
          handle: product.handle,
          title: product.title,
          tags: [...product.tags],
          createdAt: product.createdAt,
        };
        next.status = product.status;
        next.resolution = 'FOUND';
      }
    } else {
      requireValue(event.fixture === current.fixture, 'predecessor_identity');
      if (event.operation === 'predecessor_archive') {
        requireValue(
          current.resolution === 'FOUND' && current.status !== 'ARCHIVED' && event.kind === 'predecessorArchive',
          'predecessor_archive',
        );
        product = event.response.data.productUpdate?.product;
        next.resolution = 'ARCHIVE_ACKNOWLEDGED';
      } else {
        requireValue(
          event.operation === 'predecessor_readback' &&
            event.kind === 'read' &&
            (current.resolution === 'ARCHIVE_ACKNOWLEDGED' ||
              (current.resolution === 'FOUND' && current.status === 'ARCHIVED')),
          'predecessor_readback',
        );
        product = event.response.data.product;
        next.resolution = 'ARCHIVED_VERIFIED';
      }
      owned(product, current);
      requireValue(product.status === 'ARCHIVED', 'predecessor_archived_status');
      next.status = product.status;
    }
    next.observedAt = event.at;
  } catch (error) {
    next.resolution = 'STOPPED';
    next.failure = error.kind ?? 'predecessor_response';
  }
  return next;
}
// Orchestration has no transport or permission authority of its own.
export async function resolvePredecessor(operator, graph) {
  await graph(FIND, { search: `handle:${PREDECESSOR.marker}` });
  let current = operator.state().predecessor;
  requireValue(['ABSENT', 'FOUND'].includes(current.resolution), current.failure ?? 'predecessor_unresolved');
  if (current.resolution === 'FOUND') {
    if (current.status !== 'ARCHIVED') {
      await graph(SETUP, { product: { id: current.fixture, status: 'ARCHIVED' } });
      current = operator.state().predecessor;
      requireValue(current.resolution === 'ARCHIVE_ACKNOWLEDGED', current.failure ?? 'predecessor_unresolved');
    }
    await graph(FIXTURE, { id: current.fixture });
  }
  current = operator.state().predecessor;
  requireValue(
    ['ABSENT', 'ARCHIVED_VERIFIED'].includes(current.resolution),
    current.failure ?? 'predecessor_unresolved',
  );
  return current;
}
