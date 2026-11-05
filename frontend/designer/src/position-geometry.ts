/** Coordinates are percentages of the fitted garment image content rectangle. */
export interface PercentPoint {
  x: number;
  y: number;
}

/** x/y are the center; width/height are full extents, all in image percentages. */
export interface MovementArea extends PercentPoint {
  width: number;
  height: number;
}

/** x/y are top-left; width/height are full extents, all in image percentages. */
export interface ArtworkFootprint extends PercentPoint {
  width: number;
  height: number;
}

export interface PositionGeometry {
  x: number;
  y: number;
  width: number;
  dimensions: readonly number[];
  /** Optional height envelope, scaled to dimensions[0]. */
  maximumHeight?: number | undefined;
  sizeLabels?: readonly string[] | undefined;
  movementArea?: MovementArea | undefined;
}

export interface PrintGeometry {
  size: number;
  position?: PercentPoint | undefined;
}

const EPSILON = 1e-9;

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function validArea(area: MovementArea): boolean {
  return (
    Number.isFinite(area.x) &&
    Number.isFinite(area.y) &&
    finitePositive(area.width) &&
    finitePositive(area.height) &&
    area.x - area.width / 2 >= 0 &&
    area.x + area.width / 2 <= 100 &&
    area.y - area.height / 2 >= 0 &&
    area.y + area.height / 2 <= 100
  );
}

/** Missing customer position keeps the configured merchant center. */
export function resolvePrintCenter(
  position: Pick<PositionGeometry, "x" | "y">,
  print: Pick<PrintGeometry, "position">,
): PercentPoint {
  return print.position ?? { x: position.x, y: position.y };
}

/** The first configured width is the existing preview's reference scale. */
export function printWidthPercent(
  position: Pick<PositionGeometry, "width" | "dimensions">,
  sizeIndex: number,
): number {
  const selectedWidth = position.dimensions[sizeIndex];
  const referenceWidth = position.dimensions[0];
  if (
    !Number.isInteger(sizeIndex) ||
    !finitePositive(position.width) ||
    selectedWidth === undefined ||
    referenceWidth === undefined ||
    !finitePositive(selectedWidth) ||
    !finitePositive(referenceWidth)
  )
    throw new Error("invalid print size geometry");
  const width = (position.width * selectedWidth) / referenceWidth;
  if (!finitePositive(width)) throw new Error("invalid print width geometry");
  return width;
}

/** Fit a print inside an optional height envelope while keeping its aspect ratio. */
export function printWidthPercentForArtwork(
  position: Pick<PositionGeometry, "width" | "dimensions" | "maximumHeight">,
  sizeIndex: number,
  artworkAspectRatio: number,
  imageAspectRatio: number,
): number {
  const width = printWidthPercent(position, sizeIndex);
  if (position.maximumHeight === undefined) return width;
  const referenceWidth = position.dimensions[0];
  const selectedWidth = position.dimensions[sizeIndex];
  if (
    !finitePositive(position.maximumHeight) ||
    referenceWidth === undefined ||
    selectedWidth === undefined ||
    !finitePositive(artworkAspectRatio) ||
    !finitePositive(imageAspectRatio)
  ) return 0;
  const heightEnvelope = position.maximumHeight * selectedWidth / referenceWidth;
  return Math.min(width, heightEnvelope * artworkAspectRatio / imageAspectRatio);
}

/** Display merchant-defined relative names, or the existing physical label. */
export function printSizeLabel(
  position: Pick<PositionGeometry, "dimensions" | "sizeLabels">,
  sizeIndex: number,
  centimeterLabel: (dimension: number) => string = (dimension) => `${dimension} cm`,
): string {
  const dimension = position.dimensions[sizeIndex];
  if (!Number.isInteger(sizeIndex) || dimension === undefined)
    throw new Error("invalid print size label");
  return position.sizeLabels?.[sizeIndex] ?? centimeterLabel(dimension);
}

/**
 * Resolve the full, unrotated artwork box in source-image percentage units.
 * The box includes transparent padding because aspect comes from the complete
 * uploaded raster. A null result means the image dimensions or size are unusable.
 */
export function artworkFootprint(
  center: PercentPoint,
  widthPercent: number,
  artworkAspectRatio: number,
  imageAspectRatio: number,
): ArtworkFootprint | null {
  if (
    !Number.isFinite(center.x) ||
    center.x < 0 ||
    center.x > 100 ||
    !Number.isFinite(center.y) ||
    center.y < 0 ||
    center.y > 100 ||
    !finitePositive(widthPercent) ||
    widthPercent > 100 ||
    !finitePositive(artworkAspectRatio) ||
    !finitePositive(imageAspectRatio)
  )
    return null;

  const height = (widthPercent * imageAspectRatio) / artworkAspectRatio;
  if (!finitePositive(height) || height > 100) return null;
  return {
    x: center.x - widthPercent / 2,
    y: center.y - height / 2,
    width: widthPercent,
    height,
  };
}

/** Clamp a requested center so the complete artwork remains within the area. */
export function clampArtworkCenter(
  requested: PercentPoint,
  movementArea: MovementArea,
  widthPercent: number,
  artworkAspectRatio: number,
  imageAspectRatio: number,
): PercentPoint | null {
  if (!Number.isFinite(requested.x) || !Number.isFinite(requested.y))
    return null;
  if (!validArea(movementArea)) return null;
  const footprint = artworkFootprint(
    { x: 50, y: 50 },
    widthPercent,
    artworkAspectRatio,
    imageAspectRatio,
  );
  if (
    !footprint ||
    footprint.width > movementArea.width + EPSILON ||
    footprint.height > movementArea.height + EPSILON
  )
    return null;

  const halfWidth = footprint.width / 2;
  const halfHeight = footprint.height / 2;
  const minX = movementArea.x - movementArea.width / 2 + halfWidth;
  const maxX = movementArea.x + movementArea.width / 2 - halfWidth;
  const minY = movementArea.y - movementArea.height / 2 + halfHeight;
  const maxY = movementArea.y + movementArea.height / 2 - halfHeight;
  return {
    x: Math.min(maxX, Math.max(minX, requested.x)),
    y: Math.min(maxY, Math.max(minY, requested.y)),
  };
}

/** Clamp against every selected source image that shares this normalized point. */
export function clampArtworkCenterForImages(
  requested: PercentPoint,
  movementArea: MovementArea,
  widthPercent: number,
  artworkAspectRatio: number,
  imageAspectRatios: readonly number[],
): PercentPoint | null {
  if (!Number.isFinite(requested.x) || !Number.isFinite(requested.y))
    return null;
  if (!validArea(movementArea) || imageAspectRatios.length === 0) return null;

  let maxHeight = 0;
  for (const imageAspectRatio of imageAspectRatios) {
    const footprint = artworkFootprint(
      { x: 50, y: 50 },
      widthPercent,
      artworkAspectRatio,
      imageAspectRatio,
    );
    if (
      !footprint ||
      footprint.width > movementArea.width + EPSILON ||
      footprint.height > movementArea.height + EPSILON
    )
      return null;
    maxHeight = Math.max(maxHeight, footprint.height);
  }

  const halfWidth = widthPercent / 2;
  const halfHeight = maxHeight / 2;
  const minX = movementArea.x - movementArea.width / 2 + halfWidth;
  const maxX = movementArea.x + movementArea.width / 2 - halfWidth;
  const minY = movementArea.y - movementArea.height / 2 + halfHeight;
  const maxY = movementArea.y + movementArea.height / 2 - halfHeight;
  return {
    x: Math.min(maxX, Math.max(minX, requested.x)),
    y: Math.min(maxY, Math.max(minY, requested.y)),
  };
}

/** True only when the whole artwork already fits; this never moves the design. */
export function isArtworkCenterAllowed(
  center: PercentPoint,
  movementArea: MovementArea,
  widthPercent: number,
  artworkAspectRatio: number,
  imageAspectRatio: number,
): boolean {
  const clamped = clampArtworkCenter(
    center,
    movementArea,
    widthPercent,
    artworkAspectRatio,
    imageAspectRatio,
  );
  return (
    clamped !== null &&
    Math.abs(clamped.x - center.x) <= EPSILON &&
    Math.abs(clamped.y - center.y) <= EPSILON
  );
}

/** True only when a full artwork raster fits every selected image without movement. */
export function isArtworkCenterAllowedForImages(
  center: PercentPoint,
  movementArea: MovementArea,
  widthPercent: number,
  artworkAspectRatio: number,
  imageAspectRatios: readonly number[],
): boolean {
  const clamped = clampArtworkCenterForImages(
    center,
    movementArea,
    widthPercent,
    artworkAspectRatio,
    imageAspectRatios,
  );
  return (
    clamped !== null &&
    Math.abs(clamped.x - center.x) <= EPSILON &&
    Math.abs(clamped.y - center.y) <= EPSILON
  );
}

/** Preset indexes whose complete artwork can fit inside this movement area. */
export function availablePrintSizes(
  position: PositionGeometry,
  artworkAspectRatio: number,
  imageAspectRatio: number,
): number[] {
  return availablePrintSizesForImages(position, artworkAspectRatio, [
    imageAspectRatio,
  ]);
}

/** Preset indexes whose full artwork fits every selected source image. */
export function availablePrintSizesForImages(
  position: PositionGeometry,
  artworkAspectRatio: number,
  imageAspectRatios: readonly number[],
): number[] {
  const area = position.movementArea;
  if (!area || imageAspectRatios.length === 0) return [];
  const mostRestrictiveImageAspect = Math.max(...imageAspectRatios);
  return position.dimensions.flatMap((_, sizeIndex) => {
    const width = printWidthPercentForArtwork(
      position,
      sizeIndex,
      artworkAspectRatio,
      mostRestrictiveImageAspect,
    );
    if (width <= 0) return [];
    return clampArtworkCenterForImages(
      { x: area.x, y: area.y },
      area,
      width,
      artworkAspectRatio,
      imageAspectRatios,
    ) !== null
      ? [sizeIndex]
      : [];
  });
}
