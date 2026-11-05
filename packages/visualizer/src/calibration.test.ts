import { expect, it } from 'vitest';
import { calibratedDimensions } from './geometry.js';

it('projects calibrated image dimensions into production centimetres without using viewport pixels', () => {
  const calibration = {
    imageWidth: 1000,
    imageHeight: 1200,
    a: { x: 0.2, y: 0.5 },
    b: { x: 0.8, y: 0.5 },
    distanceCm: 30,
  };
  const dimensions = calibratedDimensions(calibration, { width: 0.2, height: 0.2 });
  // Source-image geometry is floating point; production snapshots choose a fixed millimetre precision.
  expect(dimensions?.widthCm).toBeCloseTo(10, 10);
  expect(dimensions?.heightCm).toBeCloseTo(12, 10);
  expect(dimensions?.pixelsPerCm).toBeCloseTo(20, 10);
  expect(calibratedDimensions({ ...calibration, b: calibration.a }, { width: 0.2, height: 0.2 })).toBeNull();
  expect(calibratedDimensions(calibration, { width: 0, height: 0.2 })).toBeNull();
});
