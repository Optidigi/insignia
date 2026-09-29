import { createHash } from 'node:crypto';
import sharp from 'sharp';

export async function runLocalDiagnostic() {
  const sourceBytes = await sharp({
    create: { width: 4, height: 4, channels: 4, background: { r: 17, g: 34, b: 51, alpha: 1 } },
  })
    .png()
    .toBuffer();
  const decoded = sharp(sourceBytes, { limitInputPixels: 16, failOn: 'error' });
  const source = await decoded.metadata();
  const derivativeBytes = await sharp(sourceBytes, { limitInputPixels: 16, failOn: 'error' })
    .resize(2, 2, { kernel: 'nearest' })
    .png()
    .toBuffer();
  const derivative = await sharp(derivativeBytes, { limitInputPixels: 4, failOn: 'error' }).metadata();
  return {
    source: { width: source.width, height: source.height, format: source.format },
    derivative: { width: derivative.width, height: derivative.height, format: derivative.format },
    sha256: createHash('sha256').update(derivativeBytes).digest('hex'),
    durableReady: false,
  };
}
