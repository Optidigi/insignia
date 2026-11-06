import { calibratedDimensions } from '@insignia/visualizer/geometry';
import { placementCalibrationSchema, type PlacementCalibration, type CalibrationPoint, type CalibrationImage } from '@insignia/contracts';
export { placementCalibrationSchema, type PlacementCalibration, type CalibrationPoint, type CalibrationImage } from '@insignia/contracts';

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

  return calibratedDimensions(calibration, rect);
}
