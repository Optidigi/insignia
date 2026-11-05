/** Stateful local catalog fixtures. No provider connection, publication or production writes. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type MerchantDraft, MerchantDraftSchema } from '@insignia/contracts';
import { createHash } from 'node:crypto';
const sha256CanonicalJson = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
import { formatMinor, validateLeanConfig } from '@insignia/domain';
import { type GeometryV1, validateGeometryBridge } from '@insignia/ui-visualizer/geometry';
import type { CatalogProduct, CommandOutcome, ConfigView } from '../../../src/shared/admin-view.js';
import { productConfigurationSummary } from '../../../src/shared/product-configuration-summary.ts';
import type { LegacyDemoProduct } from './legacy-demo-catalog.mts';
import { readGeometry } from './merchant-draft.mts';

const maximumBody = 256_000;
const publicationMessage = 'This local demo saves drafts in memory. Publishing to Shopify is unavailable.';
type ConfiguredView = ConfigView & { config: NonNullable<ConfigView['config']> };

function productNumber(id: string): string {
  const number = id.match(/^gid:\/\/shopify\/Product\/([1-9][0-9]*)$/)?.[1];
  if (!number) throw new Error('Invalid demo product ID');
  return number;
}

function validatedDraft(value: unknown, productId: string): MerchantDraft {
  const draft = MerchantDraftSchema.parse(value);
  const geometry = readGeometry(draft.geometry);
  const published = validateLeanConfig({
    ...draft,
    version: 'm2-published-config-v1',
    shopId: 'local-catalog-demo',
    productId,
    revisionId: 'local-draft',
    revisionContentHash: '0'.repeat(64),
  });
  validateGeometryBridge(geometry, published);
  return { ...draft, geometry };
}

function initialView(source: LegacyDemoProduct): ConfiguredView {
  const numericId = productNumber(source.id);
  const front = source.geometry.views.find((view) => view.image?.revisionId.endsWith('-front-preview'));
  const image = front?.image;
  if (!front || !image) throw new Error('Missing catalog front photograph');
  const imageUrl = source.imageUrls[image.revisionId];
  if (!imageUrl) throw new Error('Missing catalog front photograph URL');
  // Editable demo choices exercise multiple methods and merchant-defined labels.
  // They are saved local drafts and do not claim to be retained source configurations.
  const methods = source.handle.endsWith('hoodie')
    ? [...source.methods, { id: 'demo-embroidery', name: 'Embroidery', price: 950 }]
    : source.methods.map((method) => ({
        ...method,
        name: source.handle.endsWith('polo')
          ? 'Embroidery with individually matched thread colors for corporate uniforms'
          : method.name,
      }));
  const placements = source.placements.filter((placement) => front.placements.some((area) => area.id === placement.id));
  const stepIds = new Set(placements.flatMap((placement) => placement.steps.map((step) => step.id)));
  const geometry: GeometryV1 = {
    version: 'm5-geometry-v1',
    views: [{ ...front, image: { ...image, revisionId: `product_${numericId}` }, variantImages: [] }],
    steps: source.geometry.steps.filter((step) => stepIds.has(step.id)),
  };
  const draft = validatedDraft(
    {
      version: 'm5-merchant-draft-v1',
      mode: 'optional',
      shopCurrency: 'EUR',
      methods: methods.map((method) => ({ id: method.id })),
      placements: placements.map((placement) => ({
        id: placement.id,
        allowedMethodIds: methods.map((method) => method.id),
        allowedStepIds: placement.steps.map((step) => step.id),
        logoLaterAllowed: false,
      })),
      productionOptions: [],
      // Resolve the retained cents into Lean's final per-placement price table; the domain validates it.
      pricingRules: placements.flatMap((placement) =>
        methods.flatMap((method) =>
          placement.steps.map((step) => ({
            id: `price:${placement.id}:${step.id.split(':').at(-1)}:${method.id}`,
            scope: { kind: 'step', placementId: placement.id, methodId: method.id, stepId: step.id },
            role: 'unit',
            rate: {
              kind: 'fixed',
              amount: {
                shopDecimal: formatMinor(
                  BigInt(method.price) +
                    BigInt(placement.methodPrices[method.id] ?? placement.price) +
                    BigInt(step.price),
                  2,
                ),
                presentmentOverrides: [],
              },
            },
          })),
        ),
      ),
      labels: {
        methods: Object.fromEntries(methods.map((method) => [method.id, method.name])),
        placements: Object.fromEntries(placements.map((placement) => [placement.id, placement.name])),
        steps: Object.fromEntries(
          placements.flatMap((placement) => placement.steps.map((step) => [step.id, step.label])),
        ),
        views: { [front.id]: source.presentation.labels.views[front.id] ?? 'Front' },
      },
      geometry,
    },
    numericId,
  );
  return {
    product: {
      id: source.id,
      title: source.title,
      status: 'ACTIVE',
      imageUrl,
      variants: source.variants.map((variant) => ({
        id: variant.id,
        title: variant.title,
        imageUrl,
        selectedOptions: [
          { name: 'Kleur', value: variant.title.split(' / ').slice(0, -1).join(' / ') },
          { name: 'Maat', value: variant.size },
        ],
      })),
      variantsTruncated: false,
    },
    config: {
      configId: `demo-catalog-${numericId}`,
      installationGeneration: '1',
      draftVersion: '1',
      draft,
      currentShopCurrency: 'EUR',
      publication: {
        state: 'DRAFT',
        revisionId: null,
        sourceDraftVersion: null,
        requestKey: null,
        activeRevisionId: null,
        reason: null,
        requiresAllChannelHold: null,
        functionReadiness: null,
      },
      publishEligibility: { allowed: false, reason: publicationMessage },
    },
  };
}

class OversizedBody extends Error {}
async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > maximumBody) throw new OversizedBody();
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function createCatalogDemo(catalog: readonly LegacyDemoProduct[]) {
  const initial = catalog.map(initialView);
  const views = new Map<string, ConfiguredView>();
  const commands = new Map<string, { digest: string; outcome: CommandOutcome }>();
  let generation = 0;
  function reset(): void {
    generation++;
    views.clear();
    commands.clear();
    for (const view of initial) views.set(productNumber(view.product.id), structuredClone(view));
  }
  reset();
  return {
    get products(): CatalogProduct[] {
      return Array.from(views.values(), (view) => structuredClone(view.product));
    },
    reset,
    async handle(request: IncomingMessage, reply: ServerResponse, url: URL): Promise<boolean> {
      const list = url.pathname === '/api/admin/products';
      const numericId = url.pathname.match(/^\/api\/admin\/products\/([1-9][0-9]*)\/config$/)?.[1];
      if (!list && (!numericId || !views.has(numericId))) return false;
      const requestGeneration = generation;
      const json = (status: number, value: unknown) => {
        reply.statusCode = status;
        reply.setHeader('content-type', 'application/json; charset=utf-8');
        reply.setHeader('cache-control', 'no-store');
        reply.end(JSON.stringify(value));
      };
      try {
        if (list && request.method === 'GET') {
          const query = (url.searchParams.get('q') ?? '').trim();
          const cursor = url.searchParams.get('cursor');
          if (query.length > 100 || (cursor && !/^[1-9][0-9]{0,19}$/.test(cursor))) {
            json(422, { error: 'Invalid local catalog search' });
            return true;
          }
          const products = Array.from(views.values(), (view) => view.product).filter((product) =>
            product.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
          );
          const cursorIndex = cursor ? products.findIndex((product) => productNumber(product.id) === cursor) : -1;
          if (cursor && cursorIndex < 0)
            json(422, { error: 'Local catalog cursor is unavailable. Start from the first page.' });
          else {
            const page = products.slice(cursorIndex + 1, cursorIndex + 21);
            json(200, {
              products: page.map((product) => {
                const config = views.get(productNumber(product.id))?.config;
                return {
                  ...product,
                  configurationSummary: productConfigurationSummary(
                    config
                      ? {
                          effectiveRevisionId: config.publication.activeRevisionId ?? null,
                          draftValue: config.draft,
                        }
                      : null,
                  ),
                };
              }),
              nextCursor: products.length > cursorIndex + 21 ? productNumber(page[page.length - 1]?.id ?? '') : null,
            });
          }
          return true;
        }
        const view = numericId ? views.get(numericId) : undefined;
        if (!view || !numericId) {
          json(405, { error: 'Method unavailable in this local catalog demo' });
          return true;
        }
        if (request.method === 'GET') {
          json(200, view);
          return true;
        }
        if (request.method === 'POST') {
          json(403, { kind: 'forbidden', message: publicationMessage });
          return true;
        }
        if (request.method !== 'PUT') {
          json(405, { error: 'Method unavailable in this local catalog demo' });
          return true;
        }
        const input = await readBody(request);
        if (requestGeneration !== generation) {
          json(409, { kind: 'conflict', message: 'Local demo reset. Reload this configuration.' });
          return true;
        }
        const key = request.headers['idempotency-key'];
        if (
          typeof key !== 'string' ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(key) ||
          !isRecord(input) ||
          input.action !== 'save' ||
          Object.keys(input).length !== 4 ||
          typeof input.configId !== 'string' ||
          typeof input.draftVersion !== 'string' ||
          !/^[1-9][0-9]{0,18}$/.test(input.draftVersion)
        ) {
          json(422, { kind: 'invalid', message: 'Invalid local draft save command' });
          return true;
        }
        const digest = sha256CanonicalJson({ productId: numericId, input });
        const previous = commands.get(key);
        if (previous) {
          json(
            previous.digest === digest ? 200 : 409,
            previous.digest === digest
              ? previous.outcome
              : { kind: 'conflict', message: 'Command key was used for a different local request' },
          );
          return true;
        }
        const current = views.get(numericId);
        if (
          !current ||
          current.config.configId !== input.configId ||
          current.config.draftVersion !== input.draftVersion
        ) {
          json(409, { kind: 'conflict', message: 'This draft changed in another session. Reload it before saving.' });
          return true;
        }
        const draft = validatedDraft(input.draft, numericId);
        if (commands.size >= 1000) {
          json(422, { kind: 'invalid', message: 'Reset the local demo before saving more drafts.' });
          return true;
        }
        const draftVersion = (BigInt(current.config.draftVersion) + 1n).toString();
        const outcome = { kind: 'saved', draftVersion } satisfies CommandOutcome;
        views.set(numericId, { ...current, config: { ...current.config, draft, draftVersion } });
        commands.set(key, { digest, outcome });
        json(200, outcome);
      } catch (error) {
        json(error instanceof OversizedBody ? 413 : 422, {
          kind: 'invalid',
          message:
            error instanceof OversizedBody
              ? 'Local draft exceeds the size limit.'
              : 'Review the local draft configuration before saving.',
          validationIssues: [
            { path: 'configuration', message: 'Configuration choices, geometry or prices are invalid.' },
          ],
        });
      }
      return true;
    },
  };
}
