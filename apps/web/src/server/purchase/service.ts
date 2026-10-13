import type { ArtworkStorage } from '@insignia/application';
import {
  attachPurchaseArtwork,
  lockPurchaseArtwork,
  type PurchasePorts,
  purchaseArtworkDownload,
  purchaseArtworkPreview,
  reconcilePurchase,
} from '@insignia/application';
import { currencyExponent } from '@insignia/cart-authorization';
import { MerchantPresentationSchema, type PurchaseView, PurchaseViewSchema } from '@insignia/contracts';
import type { DurableCore, PurchaseRecord, PurchaseScope } from '@insignia/database';
import { validateGeometry } from '@insignia/visualizer/geometry';
import type { AdminActor } from '../admin/contracts.js';

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
  orders: PurchasePorts['orders'];
  storage?: Pick<ArtworkStorage, 'presignRead'>;
  clock?: () => Date;
}) {
  const now = input.clock ?? (() => new Date());
  const store = input.core.purchases;
  const ports: PurchasePorts = {
    orders: input.orders,
    offers: { get: (target) => store.getOffer(target) },
    store: { reconcile: (observation) => store.reconcile(observation) },
  };
  async function view(actor: AdminActor, purchase: PurchaseRecord): Promise<PurchaseView> {
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
          if (geometry) validateGeometry(geometry as Parameters<typeof validateGeometry>[0]);
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
          imageUrls: {},
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
      lines: purchase.bindings.flatMap((b) => b.lines.map(({ lineIndex, ...line }) => line)),
      groups,
      artworkEvents: events,
    });
  }
  return {
    appOrigin: input.appOrigin,
    authenticate: input.authenticate,
    async list(actor: AdminActor, query: { limit: number; before: string | null }) {
      const rows = await store.list(scope(actor), {
        limit: query.limit + 1,
        ...(query.before ? { before: query.before } : {}),
      });
      const page = rows.slice(0, query.limit).filter((row): row is PurchaseRecord => row !== null);
      return {
        version: 'm8-purchase-list-v1' as const,
        items: await Promise.all(page.map((row) => view(actor, row))),
        nextCursor: rows.length > query.limit ? page.at(-1)!.purchaseId : null,
      };
    },
    async get(actor: AdminActor, id: string) {
      const purchase = await store.get(scope(actor), id);
      return purchase ? view(actor, purchase) : null;
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
    async reconcile(actor: AdminActor, purchaseId: string) {
      const purchase = await store.get(scope(actor), purchaseId);
      if (!purchase) throw new Error('NOT_FOUND');
      return reconcilePurchase(
        { shopId: actor.tenantShopId, installationGeneration: actor.installationGeneration, orderId: purchase.orderId },
        ports,
      );
    },
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
