import type { ArtworkStorage } from '@insignia/application';
import {
  attachPurchaseArtwork,
  lockPurchaseArtwork,
  purchaseArtworkDownload,
  purchaseArtworkPreview,
} from '@insignia/application';
import { currencyExponent } from '@insignia/cart-authorization';
import { MerchantPresentationSchema, type PurchaseView, PurchaseViewSchema } from '@insignia/contracts';
import type { DurableCore, PurchaseRecord, PurchaseScope } from '@insignia/database';
import type { GeometryV1 } from '@insignia/visualizer/geometry';
import type { AdminActor } from '../admin/contracts.js';
import { buyerGeometry } from '../merchant-preview/geometry.ts';
import type { FrozenPreviewReader } from '../merchant-preview/read.ts';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const value = (input: unknown) => record(input).value ?? input;
function scope(actor: AdminActor): PurchaseScope {
  return { shopId: actor.tenantShopId, installationGeneration: actor.installationGeneration, kind: 'merchant' };
}
export type PurchaseServices = ReturnType<typeof createPurchaseServices>;
/** Only composition roots supply provider authority. Browser input never selects a tenant or storage key. */
export function createPurchaseServices(input: {
  core: DurableCore;
  appOrigin: string;
  authenticate(request: Request): Promise<AdminActor | null>;
  assertCurrentAccess?: (actor: AdminActor) => Promise<void>;
  orderNames?: (actor: AdminActor, orderIds: string[]) => Promise<Record<string, string | null>>;
  orderPresentation?: (
    actor: AdminActor,
    target: import('@insignia/shopify').OrderPresentationTarget,
  ) => Promise<import('@insignia/shopify').OrderPresentation | null>;
  storage?: Pick<ArtworkStorage, 'presignRead'>;
  previewImages?: FrozenPreviewReader;
  clock?: () => Date;
}) {
  const now = input.clock ?? (() => new Date());
  const store = input.core.purchases;
  async function currentAccess(actor: AdminActor) {
    try {
      if (actor.expiresAtMs <= now().getTime() || !actor.canReadOrders || !actor.canReadArtwork)
        throw new Error('Current merchant access required');
      await input.assertCurrentAccess?.(actor);
      if (actor.expiresAtMs <= now().getTime()) throw new Error('Current merchant access required');
    } catch {
      throw Object.assign(new Error('Current merchant access required'), { code: 'MERCHANT_REQUIRED' });
    }
  }
  async function view(
    actor: AdminActor,
    purchase: PurchaseRecord,
    names?: Record<string, string | null>,
  ): Promise<PurchaseView> {
    const lines = purchase.bindings.flatMap((b) => b.lines.map(({ lineIndex, ...line }) => line));
    let presentation: import('@insignia/shopify').OrderPresentation | null = null;
    if (names) presentation = { orderName: names[purchase.orderId] ?? null, lines: [] };
    if (!names && actor.canReadOrders && actor.expiresAtMs > now().getTime()) {
      try {
        presentation = (await input.orderPresentation?.(actor, { orderId: purchase.orderId, lines })) ?? null;
      } catch {
        /* Optional labels never hide durable purchase/artwork. */
      }
    }
    const groups: PurchaseView['groups'] = [];
    const authorized = new Map<string, Awaited<ReturnType<typeof store.getAuthorizedArtwork>>>();
    const events = purchase.artworkEvents;
    for (const binding of purchase.bindings) {
      if (!binding.designPayload) continue;
      for (const { group: selected } of binding.designPayload.request.groups) {
        const index = groups.length;
        const revision = binding.designPayload.revisions.find((r) => r.revisionId === selected.configRevisionId);
        let geometry: unknown | null = revision ? value(revision.geometry) : null;
        try {
          if (geometry) geometry = buyerGeometry(geometry as GeometryV1);
        } catch {
          geometry = null;
        }
        const presentation = MerchantPresentationSchema.safeParse(revision ? value(revision.presentation) : null);
        const placements: PurchaseView['groups'][number]['placements'] = [];
        for (const placement of selected.design.placements) {
          const erasedVersion = Math.max(
            0,
            ...events.filter((e) => e.kind === 'ATTACH' && (e.erasedAt || e.assetId === null)).map((e) => e.version),
          );
          const latest = [...events]
            .reverse()
            .find(
              (e) =>
                e.kind === 'ATTACH' &&
                e.groupIndex === index &&
                e.placementId === placement.placementId &&
                e.version > erasedVersion &&
                !e.erasedAt,
            );
          const assetId =
            latest?.assetId ??
            (erasedVersion === 0 && placement.artwork.kind === 'revision' ? placement.artwork.revisionId : null);
          if (assetId && !authorized.has(assetId))
            authorized.set(
              assetId,
              await store.getAuthorizedArtwork(scope(actor), { purchaseId: purchase.purchaseId, assetId }),
            );
          const asset = assetId ? authorized.get(assetId) : null;
          placements.push({
            id: placement.placementId,
            methodId: placement.methodId,
            stepId: placement.stepId,
            originalArtwork: placement.artwork,
            currentAssetId: assetId,
            currentExpiresAt: asset?.expiresAt.toISOString() ?? latest?.expiresAt ?? null,
            expired: !!assetId && (!asset || asset.expiresAt <= now()),
          });
        }
        groups.push({
          index,
          productId: selected.productId,
          configRevisionId: selected.configRevisionId,
          variants: selected.variants,
          placements,
          geometry,
          presentation: presentation.success ? presentation.data : null,
          imageUrls:
            geometry && input.previewImages
              ? await input.previewImages(scope(actor), {
                  productId: selected.productId,
                  revisionId: selected.configRevisionId,
                  geometry: geometry as GeometryV1,
                  retainUntil: new Date(binding.payloadExpiresAt),
                })
              : {},
          payloadExpiresAt: binding.payloadExpiresAt,
        });
      }
    }
    const latest = purchase.observations[0];
    const exponent = currencyExponent(purchase.currency);
    if (exponent === undefined) throw new Error('UNSUPPORTED_CURRENCY');
    return PurchaseViewSchema.parse({
      version: 'm8-purchase-v1',
      purchaseId: purchase.purchaseId,
      orderId: purchase.orderId,
      orderName: presentation?.orderName ?? null,
      orderCreatedAt: purchase.orderCreatedAt,
      isTest: purchase.isTest,
      currency: purchase.currency,
      exponent,
      originalTotalMinor: purchase.originalTotalMinor,
      firstPaidAt: purchase.firstPaidAt,
      financialStatus: latest?.financialStatus ?? 'UNKNOWN',
      cancelledAt: latest?.cancelledAt ?? null,
      exceptions: [...new Set(purchase.observations.map((o) => o.exception).filter((e): e is string => !!e))],
      artworkVersion: purchase.artworkVersion,
      artworkState: purchase.artworkState,
      refunds: purchase.refunds,
      lines: lines.map((line) => {
        const label = presentation?.lines.find((item) => item.orderLineId === line.orderLineId);
        return { ...line, title: label?.title ?? null, variantTitle: label?.variantTitle ?? null };
      }),
      groups,
      artworkEvents: events,
    });
  }
  return {
    appOrigin: input.appOrigin,
    authenticate: input.authenticate,
    async privacyRequests(actor: AdminActor, after: string | null = null) {
      return { items: await input.core.customerPrivacy.listDataRequests(scope(actor), after) };
    },
    privacyRequest: (actor: AdminActor, inboxId: string) =>
      input.core.customerPrivacy.readDataRequest(scope(actor), inboxId),
    privacyOrder: (actor: AdminActor, inboxId: string, purchaseId: string, setId: string | null = null) =>
      input.core.customerPrivacy.exportOrder(scope(actor), inboxId, purchaseId, setId),
    async list(actor: AdminActor, query: { limit: number; before: string | null }) {
      await currentAccess(actor);
      const rows = await store.list(scope(actor), {
        limit: query.limit + 1,
        ...(query.before ? { before: query.before } : {}),
      });
      const page = rows.slice(0, query.limit).filter((row): row is PurchaseRecord => row !== null);
      let names: Record<string, string | null> = {};
      if (page.length > 0 && actor.canReadOrders && actor.expiresAtMs > now().getTime()) {
        try {
          names =
            (await input.orderNames?.(
              actor,
              page.map((row) => row.orderId),
            )) ?? {};
        } catch {
          /* Labels are optional. */
        }
      }
      const items = await Promise.all(page.map((row) => view(actor, row, names)));
      await currentAccess(actor);
      return {
        version: 'm8-purchase-list-v1' as const,
        items,
        nextCursor: rows.length > query.limit ? page.at(-1)!.purchaseId : null,
      };
    },
    async get(actor: AdminActor, id: string) {
      await currentAccess(actor);
      const purchase = await store.get(scope(actor), id);
      const result = purchase ? await view(actor, purchase) : null;
      await currentAccess(actor);
      return result;
    },
    async attach(
      actor: AdminActor,
      purchaseId: string,
      command: { expectedVersion: number; groupIndex: number; placementId: string; assetId: string },
    ) {
      const authority = scope(actor);
      const asset = await input.core.artwork.get(authority, command.assetId);
      if (!asset || asset.ownerKind !== 'merchant') throw new Error('ARTWORK_UNAVAILABLE');
      return attachPurchaseArtwork({ ...authority, ownerHash: asset.ownerHash }, { ...command, purchaseId }, store);
    },
    lock: (actor: AdminActor, purchaseId: string, command: { expectedVersion: number }) =>
      lockPurchaseArtwork(scope(actor), { ...command, purchaseId }, store),
    reconcile: (actor: AdminActor, purchaseId: string) => store.requestReconciliation(scope(actor), purchaseId),
    async download(actor: AdminActor, purchaseId: string, assetId: string) {
      if (!input.storage) throw new Error('UNAVAILABLE');
      return purchaseArtworkDownload(
        scope(actor),
        { purchaseId, assetId },
        { getAuthorizedArtwork: store.getAuthorizedArtwork, storage: input.storage, clock: now },
      );
    },
    async preview(actor: AdminActor, purchaseId: string, assetId: string) {
      if (!input.storage) throw new Error('UNAVAILABLE');
      return purchaseArtworkPreview(
        scope(actor),
        { purchaseId, assetId },
        { getAuthorizedArtwork: store.getAuthorizedArtwork, storage: input.storage, clock: now },
      );
    },
  };
}
