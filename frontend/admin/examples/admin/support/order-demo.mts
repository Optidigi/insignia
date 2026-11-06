/** Stateful local demonstration. No production imports, credentials or provider writes. */
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PurchaseAttachmentSchema, PurchaseLockSchema, PurchaseViewSchema } from '@insignia/contracts';
import { validateGeometry } from '@insignia/ui-visualizer/geometry';
import { legacyDemoOrders, loadLegacyDemoCatalog } from './legacy-demo-catalog.mts';

export const demoPurchaseId = '10000000-0000-4000-8000-000000000101';
export const demoStartPurchaseId = '10000000-0000-4000-8000-000000000104';
export const demoAssetOrigin = 'https://insignia-order-demo.invalid';
const chest = '30000000-0000-4000-8000-000000000001';
const back = '30000000-0000-4000-8000-000000000002';
const replacement = '30000000-0000-4000-8000-000000000003';
const product = 'gid://shopify/Product/15464675246464';
const variants = ['gid://shopify/ProductVariant/56980145832320', 'gid://shopify/ProductVariant/56980145865088'];
const assetUrl = (path: string) => `${demoAssetOrigin}/${path}`;
type Asset = {
  original: Buffer;
  preview: Buffer;
  contentType: string;
  filename: string;
  width: number;
  height: number;
  usable: boolean;
};

async function body(request: IncomingMessage, limit = 7 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) throw new Error('Demo upload exceeds 7 MiB');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

export async function createOrderDemo() {
  const catalog = await loadLegacyDemoCatalog(assetUrl);
  const files = new Map<string, Buffer>();
  for (const name of [
    'garment-navy-front.jpg',
    'garment-navy-back.jpg',
    'north-coast-chest.svg',
    'north-coast-back.svg',
    'north-coast-chest-replacement.svg',
    'north-coast-chest.png',
    'north-coast-back.png',
    'north-coast-chest-replacement.png',
  ])
    files.set(name, await readFile(new URL(`./assets/order-demo/${name}`, import.meta.url)));
  for (const name of catalog.flatMap((product) => product.imageFiles))
    files.set(name, await readFile(new URL(`./assets/legacy-catalog/${name}`, import.meta.url)));
  const fileBytes = (name: string) => {
    const bytes = files.get(name);
    if (!bytes) throw new Error(`Missing demo asset: ${name}`);
    return bytes;
  };
  const expiresAt = new Date(Date.now() + 14 * 86400000).toISOString();
  const assets = new Map<string, Asset>();
  const initial = PurchaseViewSchema.parse({
    version: 'm8-purchase-v1',
    canUploadArtwork: true,
    purchaseId: demoPurchaseId,
    orderId: 'gid://shopify/Order/1042',
    orderName: '#1042',
    orderCreatedAt: '2026-10-20T09:42:00.000Z',
    isTest: true,
    currency: 'EUR',
    exponent: 2,
    originalTotalMinor: '10485',
    firstPaidAt: '2026-10-20T09:43:00.000Z',
    financialStatus: 'PAID',
    cancelledAt: null,
    exceptions: [],
    artworkVersion: 0,
    artworkState: 'READY',
    refunds: [],
    lines: [
      {
        orderLineId: 'demo-medium',
        title: 'Organic cotton T-shirt',
        variantTitle: 'Navy / M',
        productId: product,
        variantId: variants[0],
        quantity: 2,
        unitPriceMinor: '3495',
      },
      {
        orderLineId: 'demo-large',
        title: 'Organic cotton T-shirt',
        variantTitle: 'Navy / L',
        productId: product,
        variantId: variants[1],
        quantity: 1,
        unitPriceMinor: '3495',
      },
    ],
    groups: [
      {
        index: 0,
        productId: product,
        configRevisionId: 'demo-purchased-configuration',
        variants: [
          { variantId: variants[0], quantity: 2 },
          { variantId: variants[1], quantity: 1 },
        ],
        placements: [
          {
            id: 'chest',
            methodId: 'print',
            stepId: 'small',
            originalArtwork: { kind: 'revision', revisionId: chest },
            currentAssetId: chest,
            currentExpiresAt: expiresAt,
            expired: false,
          },
          {
            id: 'back',
            methodId: 'print',
            stepId: 'large',
            originalArtwork: { kind: 'revision', revisionId: back },
            currentAssetId: back,
            currentExpiresAt: expiresAt,
            expired: false,
          },
        ],
        geometry: validateGeometry({
          version: 'm5-geometry-v1',
          views: [
            {
              id: 'front',
              image: { revisionId: 'navy-front', width: 1200, height: 1200 },
              variantImages: [],
              placements: [{ id: 'chest', rect: { centerX: 0.6025, centerY: 0.265, width: 0.115, height: 0.12 } }],
            },
            {
              id: 'back',
              image: { revisionId: 'navy-back', width: 1200, height: 1200 },
              variantImages: [],
              placements: [{ id: 'back', rect: { centerX: 0.5, centerY: 0.37, width: 0.28, height: 0.4 } }],
            },
          ],
          steps: [
            { id: 'small', widthFraction: 0.9, heightFraction: 0.9 },
            { id: 'large', widthFraction: 0.9, heightFraction: 0.9 },
          ],
        }),
        presentation: {
          version: 'm5-presentation-v1',
          labels: {
            views: { front: 'Front', back: 'Back' },
            placements: { chest: 'Left chest', back: 'Back' },
            methods: { print: 'Screen printing' },
            steps: { small: 'Small · 10 × 10 cm', large: 'Large · 28 × 35 cm' },
          },
        },
        imageUrls: {
          'navy-front': assetUrl('files/garment-navy-front.jpg'),
          'navy-back': assetUrl('files/garment-navy-back.jpg'),
        },
        payloadExpiresAt: expiresAt,
      },
    ],
    artworkEvents: [],
  });
  const initialOrders = [initial, ...legacyDemoOrders(catalog, initial, expiresAt, { chest, back, replacement })];
  const purchases = new Map<string, typeof initial>();
  let generation = 0;
  function reset() {
    generation++;
    purchases.clear();
    for (const order of initialOrders) purchases.set(order.purchaseId, structuredClone(order));
    assets.clear();
    for (const [id, name, width, height] of [
      [chest, 'north-coast-chest', 400, 400],
      [back, 'north-coast-back', 600, 760],
      [replacement, 'north-coast-chest-replacement', 400, 400],
    ] as const)
      assets.set(id, {
        original: fileBytes(`${name}.svg`),
        preview: fileBytes(`${name}.png`),
        contentType: 'image/svg+xml',
        filename: `${name}.svg`,
        width,
        height,
        usable: true,
      });
  }
  reset();

  return {
    get orders() {
      return Array.from(purchases.values(), (purchase) => structuredClone(purchase));
    },
    async handle(request: IncomingMessage, reply: ServerResponse, url: URL): Promise<boolean> {
      const pathname = url.pathname;
      const requestGeneration = generation;
      const purchaseId = pathname.match(/^\/api\/purchases\/v1\/([0-9a-f-]+)(?:\/|$)/)?.[1];
      const purchasePath = `/api/purchases/v1/${purchaseId}`;
      let purchase = purchaseId ? purchases.get(purchaseId) : undefined;
      if (!pathname.startsWith('/__preview/demo/') && !pathname.startsWith('/api/artwork') && !purchaseId) return false;
      const json = (status: number, value: unknown) => {
        reply.statusCode = status;
        reply.setHeader('content-type', 'application/json');
        reply.end(JSON.stringify(value));
      };
      const binary = (bytes: Buffer, type: string, filename?: string) => {
        reply.setHeader('content-type', type);
        reply.setHeader('x-content-type-options', 'nosniff');
        reply.setHeader('access-control-allow-origin', '*');
        if (filename) reply.setHeader('content-disposition', `attachment; filename="${filename}"`);
        reply.end(bytes);
      };
      try {
        if (pathname === '/__preview/demo/reset' && request.method === 'POST') {
          reset();
          json(200, { reset: true });
          return true;
        }
        const file = pathname.match(/^\/__preview\/demo\/files\/([a-z0-9-]+\.(jpg|png|svg))$/);
        if (file && request.method === 'GET') {
          const name = file[1] ?? '';
          const bytes = files.get(name);
          if (!bytes) json(404, { error: 'Demo file unavailable' });
          else
            binary(
              bytes,
              file[2] === 'jpg' ? 'image/jpeg' : file[2] === 'png' ? 'image/png' : 'application/octet-stream',
              file[2] === 'jpg' ? undefined : name,
            );
          return true;
        }
        const assetPath = pathname.match(
          /^\/__preview\/demo\/(upload|preview-upload|asset)\/([0-9a-f-]+)(?:\/(preview|download))?$/,
        );
        if (assetPath) {
          const asset = assets.get(assetPath[2] ?? '');
          if (!asset) {
            json(404, { error: 'Demo artwork unavailable' });
            return true;
          }
          if (assetPath[1] === 'upload' && request.method === 'PUT' && !asset.usable) {
            asset.original = await body(request, 5 * 1024 * 1024);
            json(200, {});
            return true;
          }
          if (assetPath[1] === 'preview-upload' && request.method === 'PUT' && !asset.usable) {
            const bytes = await body(request, 2 * 1024 * 1024);
            if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
              throw new Error('Demo needs a PNG derivative');
            asset.width = bytes.readUInt32BE(16);
            asset.height = bytes.readUInt32BE(20);
            if (
              !asset.width ||
              !asset.height ||
              asset.width > 12000 ||
              asset.height > 12000 ||
              asset.width * asset.height > 40000000
            )
              throw new Error('Demo image dimensions exceeded');
            asset.preview = bytes;
            json(200, {});
            return true;
          }
          if (assetPath[1] === 'asset' && request.method === 'GET' && asset.usable) {
            if (assetPath[3] === 'preview') binary(asset.preview, 'image/png');
            else if (assetPath[3] === 'download') binary(asset.original, 'application/octet-stream', asset.filename);
            else json(404, { error: 'Demo artwork unavailable' });
            return true;
          }
        }
        if (pathname === '/api/artwork' && request.method === 'POST') {
          const declaration: unknown = JSON.parse((await body(request, 2048)).toString());
          if (requestGeneration !== generation) {
            json(409, { error: 'Demo reset. Start a new upload.' });
            return true;
          }
          if (
            !declaration ||
            typeof declaration !== 'object' ||
            !('contentType' in declaration) ||
            !('byteLength' in declaration) ||
            !['image/svg+xml', 'image/png', 'image/jpeg'].includes(String(declaration.contentType)) ||
            typeof declaration.byteLength !== 'number' ||
            declaration.byteLength < 1 ||
            declaration.byteLength > 5 * 1024 * 1024
          )
            throw new Error('Choose SVG, PNG or JPEG up to 5 MiB');
          if (assets.size >= 15) {
            json(429, { error: 'Reset the demo before uploading more files' });
            return true;
          }
          const id = randomUUID();
          const ext =
            declaration.contentType === 'image/svg+xml'
              ? 'svg'
              : declaration.contentType === 'image/png'
                ? 'png'
                : 'jpg';
          assets.set(id, {
            original: Buffer.alloc(0),
            preview: Buffer.alloc(0),
            contentType: String(declaration.contentType),
            filename: `replacement.${ext}`,
            width: 0,
            height: 0,
            usable: false,
          });
          json(200, { assetId: id, expiresAt, upload: { url: assetUrl(`upload/${id}`), headers: {} } });
          return true;
        }
        const uploadApi = pathname.match(/^\/api\/artwork\/([0-9a-f-]+)\/(complete|status|preview)$/);
        if (uploadApi) {
          const asset = assets.get(uploadApi[1] ?? '');
          if (!asset) {
            json(404, { error: 'Demo artwork unavailable' });
            return true;
          }
          if (uploadApi[2] === 'complete' && request.method === 'POST') {
            if (!asset.original.length || !asset.preview.length) throw new Error('Demo upload incomplete');
            asset.usable = true;
            json(200, {});
            return true;
          }
          if (uploadApi[2] === 'status' && request.method === 'GET') {
            json(200, { state: asset.usable ? 'USABLE' : 'UPLOADING', expiresAt });
            return true;
          }
          if (uploadApi[2] === 'preview' && request.method === 'GET' && asset.usable) {
            json(200, {
              url: assetUrl(`asset/${uploadApi[1]}/preview`),
              width: asset.width,
              height: asset.height,
              expiresAt,
            });
            return true;
          }
        }
        if (!purchase) {
          json(404, { error: 'Demo order unavailable' });
          return true;
        }
        if (pathname === purchasePath && request.method === 'GET') {
          json(200, purchase);
          return true;
        }
        const access = pathname.slice(purchasePath.length).match(/^\/artwork\/([0-9a-f-]+)\/(preview|download)$/);
        if (pathname.startsWith(purchasePath) && access && request.method === 'GET') {
          const asset = assets.get(access[1] ?? '');
          if (!asset?.usable) json(404, { error: 'Demo artwork unavailable' });
          else
            json(200, {
              url: assetUrl(`asset/${access[1]}/${access[2]}`),
              expiresAt,
              ...(access[2] === 'preview'
                ? { aspectRatio: asset.width / asset.height }
                : url.searchParams.get('metadata') === '1'
                  ? {
                      contentType: asset.contentType,
                      byteLength: asset.original.byteLength,
                      sha256: createHash('sha256').update(asset.original).digest('hex'),
                    }
                  : {}),
            });
          return true;
        }
        if (pathname === `${purchasePath}/reconcile` && request.method === 'POST') {
          json(202, purchase);
          return true;
        }
        if (
          (pathname === `${purchasePath}/artwork` || pathname === `${purchasePath}/lock`) &&
          request.method === 'POST'
        ) {
          const input: unknown = JSON.parse((await body(request, 2048)).toString());
          if (requestGeneration !== generation) {
            json(409, { error: 'Demo reset. Refresh the order.' });
            return true;
          }
          purchase = purchases.get(purchase.purchaseId);
          if (!purchase) {
            json(404, { error: 'Demo order unavailable' });
            return true;
          }
          const attachment = pathname.endsWith('/artwork');
          const parsed = attachment ? PurchaseAttachmentSchema.safeParse(input) : PurchaseLockSchema.safeParse(input);
          if (!parsed.success) throw new Error('Invalid demo command');
          if (parsed.data.expectedVersion !== purchase.artworkVersion || purchase.artworkState === 'ARTWORK_LOCKED') {
            json(409, { error: 'Artwork changed or locked. Refresh the order.' });
            return true;
          }
          if (!attachment && purchase.artworkState !== 'READY') {
            json(422, { error: 'Attach artwork to every placement before locking' });
            return true;
          }
          if (attachment) {
            const selected = PurchaseAttachmentSchema.parse(input);
            const placement = purchase.groups
              .find((g) => g.index === selected.groupIndex)
              ?.placements.find((p) => p.id === selected.placementId);
            if (!placement || !assets.get(selected.assetId)?.usable) throw new Error('Select available demo artwork');
            placement.currentAssetId = selected.assetId;
            placement.currentExpiresAt = expiresAt;
            purchase.artworkState = purchase.groups.every((group) =>
              group.placements.every((placement) => placement.currentAssetId),
            )
              ? 'READY'
              : 'PENDING_ARTWORK';
            purchase.artworkEvents.push({
              eventId: randomUUID(),
              version: ++purchase.artworkVersion,
              kind: 'ATTACH',
              groupIndex: selected.groupIndex,
              placementId: selected.placementId,
              assetId: selected.assetId,
              expiresAt,
              erasedAt: null,
            });
          } else {
            purchase.artworkState = 'ARTWORK_LOCKED';
            purchase.artworkEvents.push({
              eventId: randomUUID(),
              version: ++purchase.artworkVersion,
              kind: 'LOCK',
              groupIndex: null,
              placementId: null,
              assetId: null,
              expiresAt: null,
              erasedAt: null,
            });
          }
          purchase = PurchaseViewSchema.parse(purchase);
          purchases.set(purchase.purchaseId, purchase);
          json(200, purchase);
          return true;
        }
        json(405, { error: 'Unavailable in this local demo' });
      } catch (error) {
        json(422, { error: error instanceof Error ? error.message : 'Demo request failed' });
      }
      return true;
    },
  };
}
