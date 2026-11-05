import type { PurchaseGroup, PurchaseView } from '@insignia/contracts';
import { PurchasePrivateUrlSchema } from '@insignia/contracts';
import { formatExactCount } from '@insignia/ui-localization/core';
import { type Artwork, type GeometryV1, projectScene, validateGeometry } from '@insignia/ui-visualizer/geometry';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import AdminSkeleton from '../components/AdminSkeleton';
import { useAdminLocale } from '../shared/admin-i18n.js';
import { authenticatedJson } from '../shared/admin-request';

type PreviewNotice =
  | 'previewFailed'
  | 'designUnavailable'
  | 'accessExpired'
  | 'currentArtworkUnavailable'
  | 'purchasedArtworkUnavailable'
  | null;

/** Purchased and current compositions share geometry, but never substitute each other's artwork. */
export default function PurchaseHistoricalPreview({
  purchaseId,
  group,
  lines = [],
  deny,
  artworkSource = 'purchased',
}: {
  purchaseId: string;
  group: PurchaseGroup;
  lines?: PurchaseView['lines'];
  deny: (error: unknown) => void;
  artworkSource?: 'purchased' | 'current';
}) {
  const { t, formatLocale } = useAdminLocale();
  const element = useRef<HTMLDivElement>(null);
  const denyCurrent = useRef(deny);
  denyCurrent.current = deny;
  const [notice, setNotice] = useState<PreviewNotice>('previewFailed');
  const message = (() => {
    switch (notice) {
      case 'previewFailed':
        return t('orders:purchaseArtwork.preview.unavailable');
      case 'designUnavailable':
        return t('orders:purchaseArtwork.preview.designUnavailable');
      case 'accessExpired':
        return t('orders:purchaseArtwork.preview.accessExpired');
      case 'currentArtworkUnavailable':
        return t('orders:purchaseArtwork.preview.currentArtworkUnavailable');
      case 'purchasedArtworkUnavailable':
        return t('orders:purchaseArtwork.preview.purchasedArtworkUnavailable');
      default:
        return '';
    }
  })();
  const [visible, setVisible] = useState(Boolean(group.geometry));
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [selectedView, setSelectedView] = useState('');
  const [selectedVariant, setSelectedVariant] = useState('');
  let geometry: GeometryV1 | null = null;
  try {
    if (group.geometry) geometry = validateGeometry(group.geometry as GeometryV1);
  } catch {}
  const orderedView = geometry?.views.find((view) =>
    view.placements.some((area) => group.placements.some((placement) => placement.id === area.id)),
  );
  const viewId =
    geometry?.views.find((view) => view.id === selectedView)?.id ?? orderedView?.id ?? geometry?.views[0]?.id;
  const variantId =
    group.variants.find((variant) => variant.variantId === selectedVariant)?.variantId ?? group.variants[0]?.variantId;
  const currentArtwork = artworkSource === 'current';

  useLayoutEffect(() => {
    let ended = false;
    const request = new AbortController();
    let renderer: import('@insignia/ui-visualizer').Visualizer | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let resize: ResizeObserver | undefined;
    const unavailable = () => {
      resize?.disconnect();
      renderer?.destroy();
      setVisible(false);
      setNotice(Date.parse(group.payloadExpiresAt) <= Date.now() ? 'designUnavailable' : 'previewFailed');
    };
    const expired = () => {
      resize?.disconnect();
      renderer?.destroy();
      setVisible(false);
      setNotice('accessExpired');
    };
    async function render() {
      setBusy(true);
      try {
        if (!geometry || !element.current) {
          unavailable();
          return;
        }
        if (Date.parse(group.payloadExpiresAt) <= Date.now()) return expired();
        const view = geometry.views.find((view) => view.id === viewId);
        if (!view) return unavailable();
        const image = view.variantImages.find((image) => image.variantId === variantId)?.image ?? view.image;
        if (!image || !group.imageUrls[image.revisionId]) return unavailable();
        setVisible(true);
        const placements = group.placements.filter((placement) =>
          view.placements.some((rect) => rect.id === placement.id),
        );
        const artworkIds = [
          ...new Set<string>(
            placements.flatMap((placement) => {
              if (currentArtwork) {
                const usableUntil = placement.currentExpiresAt ? Date.parse(placement.currentExpiresAt) : 0;
                return placement.currentAssetId && !placement.expired && usableUntil > Date.now()
                  ? [placement.currentAssetId]
                  : [];
              }
              return placement.originalArtwork.kind === 'revision' ? [placement.originalArtwork.revisionId] : [];
            }),
          ),
        ];
        const originals = new Map<string, { url: string; aspectRatio: number; expiresAt: string }>();
        await Promise.all(
          artworkIds.map(async (assetId) => {
            try {
              const preview = PurchasePrivateUrlSchema.parse(
                await authenticatedJson(
                  `/api/purchases/v1/${encodeURIComponent(purchaseId)}/artwork/${encodeURIComponent(assetId)}/preview`,
                  { signal: request.signal },
                ),
              );
              if (preview.aspectRatio && Date.parse(preview.expiresAt) > Date.now())
                originals.set(assetId, { ...preview, aspectRatio: preview.aspectRatio });
            } catch (error) {
              if ([401, 403].includes((error as { status?: number }).status ?? 0)) {
                if (!ended) denyCurrent.current(error);
                throw error;
              }
              // Missing or erased artwork stays partial; never substitute another revision.
            }
          }),
        );
        if (ended) return;
        const currentAssetExpiries = currentArtwork
          ? placements.flatMap((placement) => {
              if (!placement.currentAssetId || placement.expired || !placement.currentExpiresAt) return [];
              const deadline = Date.parse(placement.currentExpiresAt);
              return deadline > Date.now() ? [deadline] : [];
            })
          : [];
        const expiresAt = Math.min(
          Date.parse(group.payloadExpiresAt),
          ...currentAssetExpiries,
          ...Array.from(originals.values(), (preview) => Date.parse(preview.expiresAt)),
        );
        if (expiresAt <= Date.now()) return expired();
        const retainedGeometry = geometry;
        let complete = true;
        const compose = (width: number) => {
          const viewport = { width, height: 320, pixelRatio: 1 };
          const base = projectScene(
            { version: 0, geometry: retainedGeometry, viewId: view.id, variantId, artwork: { kind: 'none' } },
            viewport,
            group.imageUrls,
          );
          complete = true;
          const artworks = placements.flatMap((placement) => {
            let artwork: Artwork;
            if (currentArtwork) {
              if (!placement.currentAssetId) {
                if (placement.originalArtwork.kind === 'deferred') {
                  complete = false;
                  artwork = { kind: 'logo-later' };
                } else {
                  complete = false;
                  return [];
                }
              } else {
                const usableUntil = placement.currentExpiresAt ? Date.parse(placement.currentExpiresAt) : 0;
                if (placement.expired || usableUntil <= Date.now()) {
                  complete = false;
                  return [];
                }
                const preview = originals.get(placement.currentAssetId);
                if (!preview) {
                  complete = false;
                  return [];
                }
                artwork = { kind: 'raster', url: preview.url, aspectRatio: preview.aspectRatio };
              }
            } else {
              const preview =
                placement.originalArtwork.kind === 'revision'
                  ? originals.get(placement.originalArtwork.revisionId)
                  : undefined;
              artwork =
                placement.originalArtwork.kind === 'deferred'
                  ? { kind: 'logo-later' }
                  : preview
                    ? { kind: 'raster', url: preview.url, aspectRatio: preview.aspectRatio }
                    : { kind: 'none' };
            }
            const scene = projectScene(
              {
                version: 0,
                geometry: retainedGeometry,
                viewId: view.id,
                variantId,
                selectedPlacementId: placement.id,
                selectedStepId: placement.stepId,
                artwork,
              },
              viewport,
              group.imageUrls,
            );
            if (scene.status !== 'ready' || !scene.artwork) {
              complete = false;
              return [];
            }
            return [{ placementId: placement.id, ...scene.artwork }];
          });
          // Order proofs show the chosen artwork, not the editor's available print areas.
          return { ...base, placements: [], artworks };
        };
        const { createVisualizer } = await import('@insignia/ui-visualizer');
        if (ended || !element.current) return;
        renderer = await createVisualizer({
          element: element.current,
          onCommand: () => {},
          onStatus: (status) => {
            if (ended) return;
            if (status !== 'ready') return unavailable();
            setNotice(
              currentArtwork
                ? complete
                  ? null
                  : 'currentArtworkUnavailable'
                : complete
                  ? null
                  : 'purchasedArtworkUnavailable',
            );
          },
        });
        if (ended) {
          renderer.destroy();
          return;
        }
        if (expiresAt <= Date.now()) return expired();
        renderer.setMode('preview');
        let width = Math.min(560, element.current.clientWidth) || 560;
        renderer.update(compose(width));
        resize = new ResizeObserver(() => {
          if (ended || !element.current) return;
          if (expiresAt <= Date.now()) return expired();
          const nextWidth = Math.min(560, element.current.clientWidth);
          if (nextWidth > 0 && nextWidth !== width) {
            width = nextWidth;
            renderer?.update(compose(width));
          }
        });
        resize.observe(element.current);
        expiry = setTimeout(
          () => {
            if (!ended) expired();
          },
          Math.max(0, Math.min(expiresAt - Date.now(), 2_147_483_647)),
        );
      } catch {
        if (!ended) unavailable();
      } finally {
        if (!ended) setBusy(false);
      }
    }
    void render();
    return () => {
      ended = true;
      request.abort();
      if (expiry) clearTimeout(expiry);
      resize?.disconnect();
      renderer?.destroy();
    };
  }, [artworkSource, currentArtwork, group, purchaseId, refresh, viewId, variantId]);
  return (
    <section
      aria-label={t(
        currentArtwork
          ? 'orders:purchaseArtwork.preview.currentSection'
          : 'orders:purchaseArtwork.preview.purchasedSection',
      )}
    >
      <s-stack gap="base">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
          {geometry && geometry.views.length > 1 && (
            <s-select
              label={t('orders:purchaseArtwork.preview.view')}
              value={viewId}
              disabled={busy}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (typeof value === 'string') setSelectedView(value);
              }}
            >
              {geometry.views.map((view, index) => (
                <s-option key={view.id} value={view.id}>
                  {group.presentation?.labels.views?.[view.id] ??
                    t('orders:purchaseArtwork.preview.viewFallback', {
                      formattedNumber: new Intl.NumberFormat(formatLocale).format(index + 1),
                    })}
                </s-option>
              ))}
            </s-select>
          )}
          {geometry && group.variants.length > 1 && (
            <s-select
              label={t('orders:purchaseArtwork.preview.variant')}
              value={variantId}
              disabled={busy}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (typeof value === 'string') setSelectedVariant(value);
              }}
            >
              {group.variants.map((variant, index) => (
                <s-option key={variant.variantId} value={variant.variantId}>
                  {t('orders:purchaseArtwork.preview.variantOption', {
                    variantName:
                      lines.find((line) => line.productId === group.productId && line.variantId === variant.variantId)
                        ?.variantTitle ??
                      t('orders:purchaseArtwork.preview.variantFallback', {
                        formattedNumber: new Intl.NumberFormat(formatLocale).format(index + 1),
                      }),
                    formattedQuantity: formatExactCount(BigInt(variant.quantity), formatLocale).formatted,
                  })}
                </s-option>
              ))}
            </s-select>
          )}
        </s-grid>
        <div
          data-design-ready={!busy && !message ? 'true' : 'false'}
          style={{ position: 'relative', width: '100%', maxWidth: '560px', marginInline: 'auto' }}
        >
          <div
            ref={element}
            style={{ height: visible ? '320px' : '0', overflow: 'hidden', visibility: busy ? 'hidden' : 'visible' }}
          />
          {busy && (
            <div style={{ position: 'absolute', inset: '0' }}>
              <AdminSkeleton
                label={t(
                  currentArtwork
                    ? 'orders:purchaseArtwork.preview.loadingCurrent'
                    : 'orders:purchaseArtwork.preview.loadingPurchased',
                )}
                rows={2}
              />
            </div>
          )}
        </div>
        {!busy && message && (
          <div role="status" aria-live="polite">
            <s-paragraph>{message}</s-paragraph>
          </div>
        )}
        {group.geometry && !busy && message && Date.parse(group.payloadExpiresAt) > Date.now() && (
          <s-button disabled={busy} onClick={() => setRefresh((value) => value + 1)}>
            {t(
              notice === 'accessExpired'
                ? 'orders:purchaseArtwork.preview.loadPreview'
                : 'orders:purchaseArtwork.preview.tryAgain',
            )}
          </s-button>
        )}
      </s-stack>
    </section>
  );
}
