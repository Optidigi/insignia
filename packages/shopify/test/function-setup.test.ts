import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from 'vitest';
import { provisionOwnedFunctions } from '../src/function-setup.js';
import type { PublicationAdminTransport } from '../src/publication-admin.js';

const tenant = {
  shopId: 'synthetic',
  installationGeneration: '3',
  shopifyShopId: 'gid://shopify/Shop/101',
  appId: '123',
};
const expected = {
  appKey: 'synthetic-client',
  observationVersion: 2 as const,
  transformInputQuerySha256: createHash('sha256').update('query{}').digest('hex'),
  validationInputQuerySha256: createHash('sha256').update('query{}').digest('hex'),
};
test.each(['settled', 'ambiguous', 'drift', 'existing', 'partial', 'foreign', 'expired'] as const)(
  'operator %s settlement controls the next write',
  async (scenario) => {
    const attempts: string[] = [],
      reservations = new Set<string>();
    let transformed = ['existing', 'partial', 'foreign'].includes(scenario),
      validated = scenario === 'existing';
    const transform = { id: 'gid://shopify/CartTransform/101', functionId: 'transform-id', blockOnFailure: true };
    const functionRef = { id: 'validation-id', handle: 'insignia-experimental-v2-validation', appKey: expected.appKey };
    const validation = {
      id: 'gid://shopify/Validation/102',
      enabled: true,
      blockOnFailure: true,
      shopifyFunction: functionRef,
    };
    const connection = (nodes: unknown[]) => ({ nodes, pageInfo: { hasNextPage: false } });
    const server = createServer(async (incoming, outgoing) => {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const request = JSON.parse(Buffer.concat(chunks).toString());
      const reply = () => {
        if (request.operation === 'function_ownership')
          return {
            status: 200,
            body: {
              data: {
                shop: { id: tenant.shopifyShopId },
                shopifyFunctions: connection([
                  {
                    id: 'transform-id',
                    handle: 'insignia-experimental-v2-transform',
                    appKey: expected.appKey,
                    apiType: 'cart_transform',
                    apiVersion: '2026-07',
                    inputQuery: null,
                  },
                  { ...functionRef, apiType: 'cart_checkout_validation', apiVersion: '2026-07', inputQuery: null },
                ]),
                cartTransforms: connection(
                  transformed
                    ? [
                        {
                          ...transform,
                          blockOnFailure: scenario !== 'drift',
                          functionId: scenario === 'foreign' ? 'foreign-id' : transform.functionId,
                        },
                      ]
                    : [],
                ),
                validations: connection(validated ? [validation] : []),
              },
            },
          };
        attempts.push(request.operation);
        if (scenario === 'ambiguous') throw new Error('SYNTHETIC_PRIVATE_PROVIDER_FAILURE');
        if (request.operation === 'function_transform_create') {
          transformed = true;
          return { status: 200, body: { data: { cartTransformCreate: { cartTransform: transform, userErrors: [] } } } };
        }
        validated = true;
        return { status: 200, body: { data: { validationCreate: { validation, userErrors: [] } } } };
      };
      try {
        outgoing.end(JSON.stringify(reply().body));
      } catch {
        incoming.socket.destroy();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    const transport: PublicationAdminTransport = {
      async execute(request, beforeSend) {
        if (request.operation !== 'function_ownership' && !beforeSend?.()) throw new Error('not admitted');
        const response = await fetch(`http://127.0.0.1:${address.port}`, {
          method: 'POST',
          body: JSON.stringify(request),
        });
        return { status: response.status, body: await response.json() };
      },
    };
    try {
      const result = await provisionOwnedFunctions({
        tenant,
        expected,
        functionIds: { transform: 'transform-id', validation: 'validation-id' },
        transport,
        clock: () => new Date('2026-10-11T20:00:00Z'),
        verifyAuthority: async () => new Date(scenario === 'expired' ? '2026-10-11T20:00:00Z' : '2026-10-11T20:00:30Z'),
        verifyClosingAuthority: async () => new Date('2026-10-11T20:00:30Z'),
        journal: {
          reserve(operation) {
            if (reservations.has(operation)) throw new Error('duplicate');
            reservations.add(operation);
            return true;
          },
          settle() {},
          finish() {},
        },
      });
      expect(result.classification).toBe(
        ['settled', 'existing'].includes(scenario) ? 'FUNCTIONS_VERIFIED' : 'FUNCTION_SETUP_STOPPED',
      );
      expect(attempts).toEqual(
        scenario === 'settled'
          ? ['function_transform_create', 'function_validation_create']
          : ['ambiguous', 'drift'].includes(scenario)
            ? ['function_transform_create']
            : [],
      );
      expect(result.retryAuthorized).toBe(false);
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
