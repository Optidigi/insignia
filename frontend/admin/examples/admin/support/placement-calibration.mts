import { z } from 'zod';

const normalizedPointSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
  })
  .strict();

export const placementCalibrationSchema = z
  .object({
    imageUrl: z.string().url(),
    imageWidth: z.number().int().positive().finite(),
    imageHeight: z.number().int().positive().finite(),
    a: normalizedPointSchema,
    b: normalizedPointSchema,
    distanceCm: z.number().finite().positive(),
  })
  .strict()
  .refine(
    ({ imageWidth, imageHeight, a, b }) => Math.hypot((b.x - a.x) * imageWidth, (b.y - a.y) * imageHeight) > 0,
    'Calibration points must be different.',
  );

export type PlacementCalibration = z.infer<typeof placementCalibrationSchema>;
export type CalibrationPoint = PlacementCalibration['a'];
export type CalibrationImage = Pick<PlacementCalibration, 'imageUrl' | 'imageWidth' | 'imageHeight'>;

export type ApproximatePlacementDimensions = {
  widthCm: number;
  heightCm: number;
  pixelsPerCm: number;
};

/** Return true only while the calibration still describes the selected source image. */
export function calibrationMatchesImage(calibration: PlacementCalibration, image: CalibrationImage): boolean {
  if (!placementCalibrationSchema.safeParse(calibration).success) return false;
  return (
    calibration.imageUrl === image.imageUrl &&
    calibration.imageWidth === image.imageWidth &&
    calibration.imageHeight === image.imageHeight
  );
}

/** Convert a normalized placement rectangle to approximate centimeters for this image only. */
export function approximatePlacementDimensions(
  calibration: PlacementCalibration,
  rect: { width: number; height: number },
): ApproximatePlacementDimensions | null {
  if (!placementCalibrationSchema.safeParse(calibration).success) return null;
  if (
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.width > 1 ||
    rect.height <= 0 ||
    rect.height > 1
  )
    return null;

  const linePixels = Math.hypot(
    (calibration.b.x - calibration.a.x) * calibration.imageWidth,
    (calibration.b.y - calibration.a.y) * calibration.imageHeight,
  );
  if (!Number.isFinite(linePixels) || linePixels <= 0) return null;

  const pixelsPerCm = linePixels / calibration.distanceCm;
  const widthCm = (rect.width * calibration.imageWidth) / pixelsPerCm;
  const heightCm = (rect.height * calibration.imageHeight) / pixelsPerCm;
  if (![pixelsPerCm, widthCm, heightCm].every(Number.isFinite)) return null;
  return { widthCm, heightCm, pixelsPerCm };
}
