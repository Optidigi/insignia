import type { PurchaseGroup } from '@insignia/contracts';
import { PurchasePrivateUrlSchema } from '@insignia/contracts';
import { type GeometryV1, projectScene, validateGeometry } from '@insignia/visualizer/geometry';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import AdminSkeleton from '../components/AdminSkeleton';
import { authenticatedJson } from '../shared/admin-request';

/** The purchased design always uses its original artwork, never a later replacement. */
export default function PurchaseHistoricalPreview({
  purchaseId,
  group,
  deny,
}: {
  purchaseId: string;
  group: PurchaseGroup;
  deny: (error: unknown) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const denyCurrent = useRef(deny);
  denyCurrent.current = deny;
  const [message, setMessage] = useState('Historical preview unavailable.');
  const [visible, setVisible] = useState(Boolean(group.geometry));
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [selectedView, setSelectedView] = useState('');
  const [selectedVariant, setSelectedVariant] = useState('');
  let geometry: GeometryV1 | null = null;
  try {
    if (group.geometry) geometry = validateGeometry(group.geometry as GeometryV1);
  } catch {}
  const viewId = geometry?.views.find((view) => view.id === selectedView)?.id ?? geometry?.views[0]?.id;
  const variantId =
    group.variants.find((variant) => variant.variantId === selectedVariant)?.variantId ?? group.variants[0]?.variantId;

  useLayoutEffect(() => {
    let ended = false;
    let renderer: import('@insignia/visualizer').Visualizer | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const unavailable = () => {
      renderer?.destroy();
      setVisible(false);
      setMessage('Historical preview unavailable.');
    };
    const expired = () => {
      renderer?.destroy();
      setVisible(false);
      setMessage('Historical preview expired. Refresh to check current access.');
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
        const originalIds = [
          ...new Set(
            placements.flatMap((placement) =>
              placement.originalArtwork.kind === 'revision' ? [placement.originalArtwork.revisionId] : [],
            ),
          ),
        ];
        const originals = new Map<string, { url: string; aspectRatio: number; expiresAt: string }>();
        await Promise.all(
          originalIds.map(async (assetId) => {
            try {
              const preview = PurchasePrivateUrlSchema.parse(
                await authenticatedJson(
                  `/api/purchases/v1/${encodeURIComponent(purchaseId)}/artwork/${encodeURIComponent(assetId)}/preview`,
                ),
              );
              if (preview.aspectRatio && Date.parse(preview.expiresAt) > Date.now())
                originals.set(assetId, { ...preview, aspectRatio: preview.aspectRatio });
            } catch (error) {
              if ([401, 403].includes((error as { status?: number }).status ?? 0)) {
                if (!ended) denyCurrent.current(error);
                throw error;
              }
              // Missing or erased originals are explicit partial history, never a replacement.
            }
          }),
        );
        if (ended) return;
        const expiresAt = Math.min(
          Date.parse(group.payloadExpiresAt),
          ...Array.from(originals.values(), (preview) => Date.parse(preview.expiresAt)),
        );
        if (expiresAt <= Date.now()) return expired();
        const viewport = { width: 560, height: 320, pixelRatio: 1 };
        const base = projectScene(
          { version: 0, geometry, viewId: view.id, variantId, artwork: { kind: 'none' } },
          viewport,
          group.imageUrls,
        );
        let complete = true;
        const artworks = placements.flatMap((placement) => {
          const preview =
            placement.originalArtwork.kind === 'revision'
              ? originals.get(placement.originalArtwork.revisionId)
              : undefined;
          const artwork =
            placement.originalArtwork.kind === 'deferred'
              ? { kind: 'logo-later' as const }
              : preview
                ? { kind: 'raster' as const, url: preview.url, aspectRatio: preview.aspectRatio }
                : { kind: 'none' as const };
          const scene = projectScene(
            {
              version: 0,
              geometry,
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
        const { createVisualizer } = await import('@insignia/visualizer');
        if (ended || !element.current) return;
        renderer = await createVisualizer({
          element: element.current,
          onCommand: () => {},
          onStatus: (status) => {
            if (ended) return;
            if (status !== 'ready') return unavailable();
            setMessage(
              complete
                ? 'Historical purchased artwork preview.'
                : 'Historical preview: some original artwork is unavailable.',
            );
          },
        });
        if (ended) {
          renderer.destroy();
          return;
        }
        if (expiresAt <= Date.now()) return expired();
        renderer.setMode('preview');
        renderer.update({ ...base, artworks });
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
      if (expiry) clearTimeout(expiry);
      renderer?.destroy();
    };
  }, [group, purchaseId, refresh, viewId, variantId]);
  return (
    <section aria-label="Purchased design preview">
      <div class="historical-preview-controls">
        {geometry && geometry.views.length > 1 && (
          <s-select
            label="Preview view"
            value={viewId}
            disabled={busy}
            onChange={(event) => setSelectedView(event.currentTarget.value)}
          >
            {geometry.views.map((view, index) => (
              <s-option key={view.id} value={view.id}>
                {group.presentation?.labels.views?.[view.id] ?? `View ${index + 1}`}
              </s-option>
            ))}
          </s-select>
        )}
        {group.variants.length > 1 && (
          <s-select
            label="Purchased variant"
            value={variantId}
            disabled={busy}
            onChange={(event) => setSelectedVariant(event.currentTarget.value)}
          >
            {group.variants.map((variant, index) => (
              <s-option
                key={variant.variantId}
                value={variant.variantId}
              >{`Variant ${index + 1} · ${variant.quantity} purchased`}</s-option>
            ))}
          </s-select>
        )}
      </div>
      <div style={{ position: 'relative', width: '100%', maxWidth: '560px' }}>
        <div
          ref={element}
          style={{ height: visible ? '320px' : '0', overflow: 'hidden', visibility: busy ? 'hidden' : 'visible' }}
        />
        {busy && (
          <div style={{ position: 'absolute', inset: '0' }}>
            <AdminSkeleton label="Loading purchased design preview" rows={2} />
          </div>
        )}
      </div>
      {!busy && (
        <div role="status" aria-live="polite">
          <s-paragraph>{message}</s-paragraph>
        </div>
      )}
      {group.geometry && (
        <s-button disabled={busy} onClick={() => setRefresh((value) => value + 1)}>
          Refresh historical preview
        </s-button>
      )}
    </section>
  );
}
