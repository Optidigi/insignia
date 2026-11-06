import type { CustomerArtworkPublicViewDto } from '@insignia/contracts';
import { validateGeometry } from '@insignia/visualizer/geometry';
import { buildCustomerPreviewConfig } from './artwork-preview-config';
import type { ProductConfig } from './config';
import { buildPublishedDesigner, designerAlias } from './live-config';

type Configuration = CustomerArtworkPublicViewDto['configurations'][number];
/** Customer upload-only availability is not a financial quote and cannot acquire cart authority. */
export function buildCustomerArtworkConfig(
  value: Configuration,
  currency: 'USD' | 'EUR',
  origin: string,
): ProductConfig {
  const geometry = validateGeometry(value.geometry as Parameters<typeof validateGeometry>[0]),
    product = value.readProduct ?? value.selectedSetup?.product;
  if (!product) throw new Error('Purchased configuration unavailable');
  let config: ProductConfig;
  if (product.variantPhotos) {
    const metadata = product.variantPhotos;
    const variants = value.variantIds.map((id) => {
      const variant = metadata.variants.find(
        (variant) => variant.id === `gid://shopify/ProductVariant/${id}` || variant.id === id,
      );
      if (!variant) throw new Error('Purchased appearance unavailable');
      return {
        id,
        label: variant.label ?? product.title,
        available: true,
        baseUnitMinor: '0',
        selectedOptions: metadata.options.map((option) => {
          const text = variant.optionValues[option.id];
          if (!text) throw new Error('Purchased appearance unavailable');
          return { name: option.name, value: text };
        }),
      };
    });
    const imageUrls = Object.fromEntries(product.images.map((image) => [image.id, image.url]));
    config = buildPublishedDesigner(
      {
        productId: value.productId,
        revisionId: value.revisionId,
        contentHash: value.contentHash,
        shopCurrency: currency,
        title: product.title,
        ...(value.selectedSetup ? { selectedSetup: value.selectedSetup } : {}),
        ...(value.readProduct ? { readProduct: value.readProduct } : {}),
        ...(value.stepBindings ? { stepBindings: value.stepBindings } : {}),
        variantRowsById: !!value.readProduct,
        geometry,
        imageUrls,
        variants,
        options: [],
        placements: value.slots.map((slot) => ({ id: slot.placementId, allowedStepIds: [slot.stepId] })),
        decorationPrices: value.slots.map((slot) => ({
          placementId: slot.placementId,
          methodId: slot.methodId,
          stepId: slot.stepId,
          minor: '0',
        })),
      },
      { locale: 'en', storeName: product.title },
    ).config;
  } else {
    if (
      geometry.views.some(
        (view) => view.variantImages.length || view.placements.some((placement) => placement.variantOverrides?.length),
      )
    )
      throw new Error('Purchased appearance metadata unavailable');
    if (!value.selectedSetup) throw new Error('Purchased appearance unavailable');
    config = buildCustomerPreviewConfig(value.selectedSetup.product, origin, undefined, currency);
  }
  config = {
    ...config,
    artworkOnly: true,
    ...(value.readProduct && config.optionPresentation
      ? {
          optionPresentation: {
            ...config.optionPresentation,
            rowOption: { ...config.optionPresentation.rowOption, labelSource: 'generic-selection' },
          },
        }
      : {}),
    positions: config.positions.map((position) => {
      const slot = value.slots.find((slot) => designerAlias(slot.placementId) === position.id);
      const physical = slot ? geometry.steps.find((step) => step.id === slot.stepId)?.physicalMm : undefined;
      if (!physical) throw new Error('Purchased production size unavailable');
      const selected = value.positions.find((selected) => selected.placementId === slot?.placementId)?.position;
      return {
        ...position,
        dimensions: [physical.width / 10],
        ...(selected ? { x: selected.xMicros / 10000, y: selected.yMicros / 10000 } : {}),
        artworkLater: false,
      };
    }),
  };
  if (config.positionOverrides)
    config.positionOverrides = Object.fromEntries(
      Object.entries(config.positionOverrides).map(([row, placements]) => [
        row,
        Object.fromEntries(
          Object.entries(placements).map(([id, placement]) => {
            const selected = value.positions.find((selected) => designerAlias(selected.placementId) === id)?.position;
            return [
              id,
              { ...placement, ...(selected ? { x: selected.xMicros / 10000, y: selected.yMicros / 10000 } : {}) },
            ];
          }),
        ),
      ]),
    );
  return config;
}
