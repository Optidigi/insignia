type ShareablePurchase = {
  canUploadArtwork?: boolean;
  canShareCustomerArtwork?: boolean;
  lines: readonly unknown[];
  artworkState: string;
  cancelledAt: string | null;
  artworkEvents: readonly { kind: string; groupIndex?: number | null; placementId?: string | null }[];
  groups: readonly {
    index: number;
    payloadExpiresAt: string;
    placements: readonly {
      id: string;
      originalArtwork: { kind: string };
      currentAssetId: string | null;
      expired: boolean;
    }[];
  }[];
};
/** Expired or erased prior artwork is merchant replacement work, never a new customer slot. */
export function hasCustomerArtworkSlots(purchase: ShareablePurchase, now = Date.now()): boolean {
  return (
    purchase.canUploadArtwork === true &&
    purchase.canShareCustomerArtwork === true &&
    purchase.lines.length > 0 &&
    !purchase.cancelledAt &&
    purchase.artworkState !== 'ARTWORK_LOCKED' &&
    purchase.artworkState !== 'ERASED' &&
    !purchase.artworkEvents.some((event) => event.kind === 'LOCK') &&
    purchase.groups.some(
      (group) =>
        Date.parse(group.payloadExpiresAt) > now &&
        group.placements.some(
          (placement) =>
            placement.originalArtwork.kind === 'deferred' &&
            !placement.currentAssetId &&
            !placement.expired &&
            !purchase.artworkEvents.some(
              (event) =>
                event.kind === 'ATTACH' && event.groupIndex === group.index && event.placementId === placement.id,
            ),
        ),
    )
  );
}
/** Keep only this exact retry identity and returned capability in memory. Never store or log the URL. */
export function createCustomerArtworkLinkClient(
  purchaseId: string,
  request: (path: string, init: RequestInit) => Promise<unknown>,
  writeClipboard: (value: string) => Promise<void>,
  uuid: () => string = () => crypto.randomUUID(),
  expectedOrigin?: string,
) {
  let requestId: string | undefined;
  let result: { url: string; expiresAt: string } | undefined;
  let running: Promise<void> | undefined;
  async function copy() {
    if (!result) {
      requestId ??= uuid();
      const response = await request(`/api/admin/purchases/${encodeURIComponent(purchaseId)}/artwork-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId }),
      });
      if (
        !response ||
        typeof response !== 'object' ||
        !('url' in response) ||
        typeof response.url !== 'string' ||
        !('expiresAt' in response) ||
        typeof response.expiresAt !== 'string' ||
        !('purchaseId' in response) ||
        response.purchaseId !== purchaseId
      )
        throw new Error('Invalid artwork link');
      const url = new URL(response.url);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.pathname !== '/artwork-upload' ||
        !/^#capability=[a-f0-9]{64}$/.test(url.hash) ||
        (expectedOrigin && url.origin !== expectedOrigin)
      )
        throw new Error('Invalid artwork link');
      result = { url: response.url, expiresAt: response.expiresAt };
    }
    if (!Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= Date.now())
      throw new Error('Artwork link expired');
    await writeClipboard(result.url);
  }
  return {
    copy() {
      running ??= copy().finally(() => {
        running = undefined;
      });
      return running;
    },
  };
}
