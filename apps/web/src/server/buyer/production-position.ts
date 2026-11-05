import { type BuyerDesiredGroup, readSelectedStepIdentity, type SelectedProductSetup } from '@insignia/contracts';
import type { GeometryV1 } from '@insignia/visualizer/geometry';
import { buyerGeometry } from '../merchant-preview/geometry.ts';

export type PositionValidationPorts = {
  presentation(revisionId: string): Promise<{ selectedSetup?: SelectedProductSetup } | null>;
  geometry(revisionId: string): Promise<{ value: unknown } | null>;
  artwork(
    assetId: string,
  ): Promise<{ state: string; expiresAt: Date; manifest: { width: number; height: number } | null } | null>;
  now(): Date;
};
/** The signed design binds exact micros; the server checks the complete footprint against immutable publication. */
export async function validateBuyerProductionPositions(
  groups: readonly BuyerDesiredGroup[],
  ports: PositionValidationPorts,
): Promise<void> {
  for (const group of groups) {
    if (!group.design.placements.some((placement) => placement.position)) continue;
    const presentation = await ports.presentation(group.configRevisionId);
    const stored = await ports.geometry(group.configRevisionId);
    if (!presentation?.selectedSetup || !stored) throw new Error('Production movement unavailable');
    const geometry = buyerGeometry(stored.value as GeometryV1);
    for (const selection of group.design.placements) {
      if (!selection.position) continue;
      const matches = presentation.selectedSetup.product.views.flatMap((view) =>
        view.placements
          .filter((placement) => placement.id === selection.placementId)
          .map((placement) => ({ view, placement })),
      );
      const match = matches.length === 1 ? matches[0] : undefined;
      if (!match?.placement.customPlacementAllowed || !match.placement.movementRect)
        throw new Error('Movement not allowed');
      const selectedSize = match.placement.sizes.find(
        (size) => readSelectedStepIdentity(match.placement.id, size.id, [selection.stepId]) === selection.stepId,
      );
      const step = geometry.steps.find((step) => step.id === selection.stepId);
      const view = geometry.views.find((view) => view.id === match.view.id);
      if (!selectedSize || !step || !view) throw new Error('Production geometry unavailable');
      let artworkAspect: number | undefined;
      if (selection.artwork.kind === 'revision') {
        const asset = await ports.artwork(selection.artwork.revisionId);
        if (
          !asset?.manifest ||
          asset.state !== 'USABLE' ||
          asset.expiresAt <= ports.now() ||
          !Number.isFinite(asset.manifest.width) ||
          !Number.isFinite(asset.manifest.height) ||
          asset.manifest.width <= 0 ||
          asset.manifest.height <= 0
        )
          throw new Error('Production artwork unavailable');
        artworkAspect = asset.manifest.width / asset.manifest.height;
      }
      const center = { x: selection.position.xMicros / 1000000, y: selection.position.yMicros / 1000000 };
      const sourceMovement = match.placement.movementRect;
      for (const variant of group.variants) {
        const placement = view.placements.find((placement) => placement.id === selection.placementId);
        const rect =
          placement?.variantOverrides?.find((override) => override.variantId === variant.variantId)?.rect ??
          placement?.rect;
        const image = view.variantImages.find((image) => image.variantId === variant.variantId)?.image ?? view.image;
        if (
          !rect ||
          !image ||
          !Number.isFinite(image.width) ||
          !Number.isFinite(image.height) ||
          image.width <= 0 ||
          image.height <= 0
        )
          throw new Error('Production photo geometry unavailable');
        const from = match.placement.rect;
        const movement = {
          centerX: rect.centerX + ((sourceMovement.centerX - from.centerX) * rect.width) / from.width,
          centerY: rect.centerY + ((sourceMovement.centerY - from.centerY) * rect.height) / from.height,
          width: (sourceMovement.width * rect.width) / from.width,
          height: (sourceMovement.height * rect.height) / from.height,
        };
        let width = rect.width * step.widthFraction;
        const maximumHeight = rect.height * step.heightFraction;
        let height = maximumHeight;
        if (artworkAspect !== undefined) {
          height = (width * (image.width / image.height)) / artworkAspect;
          if (height > maximumHeight) {
            width *= maximumHeight / height;
            height = maximumHeight;
          }
        }
        if (
          !Number.isFinite(width) ||
          !Number.isFinite(height) ||
          width <= 0 ||
          height <= 0 ||
          center.x - width / 2 < movement.centerX - movement.width / 2 - 1e-9 ||
          center.x + width / 2 > movement.centerX + movement.width / 2 + 1e-9 ||
          center.y - height / 2 < movement.centerY - movement.height / 2 - 1e-9 ||
          center.y + height / 2 > movement.centerY + movement.height / 2 + 1e-9
        )
          throw new Error('Artwork position outside allowed production area');
      }
    }
  }
}
