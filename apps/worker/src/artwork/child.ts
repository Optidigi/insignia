import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { assertSingleJpeg } from './jpeg-policy.js';
import { assertSafeSvg } from './svg-policy.js';

const PREVIEW_EDGE = 512;
/** EXIF orientation as sharp operations; sharp mirrors before it rotates. */
const ORIENTATION: Record<number, { rotate: number; flip?: boolean; flop?: boolean }> = {
  2: { rotate: 0, flop: true },
  3: { rotate: 180 },
  4: { rotate: 0, flip: true },
  5: { rotate: 90, flip: true },
  6: { rotate: 90 },
  7: { rotate: 90, flop: true },
  8: { rotate: 270 },
};

sharp.cache(false);
sharp.concurrency(1);
process.stderr.write('INSIGNIA_INSPECTION_STARTED\n');
const chunks: Buffer[] = [];
let length = 0;
let phase: 'input' | 'policy' | 'decode' | 'output' = 'input';
try {
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 5 * 1024 * 1024) {
      phase = 'policy';
      throw new Error('Artwork size limit');
    }
    chunks.push(chunk);
  }
  phase = 'policy';
  const bytes = Buffer.concat(chunks);
  if (!bytes.length) throw new Error('Empty artwork');
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!png && !jpeg) assertSafeSvg(bytes);
  if (png) {
    // Walk to IEND. Bytes after IEND are inert to decoders and kept only in the download-only original.
    let offset = 8;
    let ended = false;
    while (offset + 12 <= bytes.length) {
      const size = bytes.readUInt32BE(offset);
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      if (size > bytes.length - offset - 12) throw new Error('Truncated PNG');
      if (type === 'acTL') throw new Error('Animation forbidden');
      offset += size + 12;
      if (type === 'IEND') {
        ended = true;
        break;
      }
    }
    if (!ended) throw new Error('Invalid PNG termination');
  }
  if (jpeg) assertSingleJpeg(bytes);
  phase = 'decode';
  const options = { limitInputPixels: 40_000_000, failOn: 'warning', animated: true, sequentialRead: true } as const;
  const image = sharp(bytes, options);
  const metadata = await image.metadata();
  const expected = png ? 'png' : jpeg ? 'jpeg' : 'svg';
  if (
    metadata.format !== expected ||
    !metadata.width ||
    !metadata.height ||
    metadata.width > 12000 ||
    metadata.height > 12000 ||
    metadata.width * metadata.height > 40_000_000 ||
    (metadata.pages ?? 1) !== 1
  )
    throw new Error('Artwork format/dimension/animation limit');
  const orientation = ORIENTATION[metadata.orientation ?? 1];
  const turned = orientation?.rotate === 90 || orientation?.rotate === 270;
  let preview: Buffer;
  if (expected === 'svg') {
    // Vectors are rasterized directly at preview scale, so a 24x24 icon still yields a 512px preview.
    const density = (72 * PREVIEW_EDGE) / Math.max(metadata.width, metadata.height);
    preview = await sharp(bytes, { ...options, density })
      .resize({ width: PREVIEW_EDGE, height: PREVIEW_EDGE, fit: 'inside' })
      .png()
      .toBuffer();
  } else {
    // Full decode precedes resize, so truncated or corrupt input is never accepted by metadata alone.
    const decoded = await image.raw().toBuffer({ resolveWithObject: true });
    preview = await sharp(decoded.data, {
      raw: { width: decoded.info.width, height: decoded.info.height, channels: decoded.info.channels },
    })
      .resize({ width: PREVIEW_EDGE, height: PREVIEW_EDGE, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    // The raw decode carries no EXIF: orient the small preview explicitly. The original keeps its EXIF.
    if (orientation)
      preview = await sharp(preview)
        .rotate(orientation.rotate)
        .flip(!!orientation.flip)
        .flop(!!orientation.flop)
        .png()
        .toBuffer();
  }
  phase = 'output';
  process.stdout.write(
    JSON.stringify({
      version: 'm6-inspection-v1',
      mimeType: png ? 'image/png' : jpeg ? 'image/jpeg' : 'image/svg+xml',
      width: turned ? metadata.height : metadata.width,
      height: turned ? metadata.width : metadata.height,
      originalSha256: createHash('sha256').update(bytes).digest('hex'),
      preview: preview.toString('base64'),
      previewMimeType: 'image/png',
    }),
  );
} catch (error) {
  const code = (error as { code?: string })?.code;
  const unavailable =
    phase === 'input' ||
    phase === 'output' ||
    ['ENOMEM', 'ENOENT', 'EIO', 'EMFILE', 'ENFILE', 'EACCES'].includes(code ?? '');
  process.stderr.write(unavailable ? 'Artwork inspector unavailable' : 'Artwork rejected by inspection policy');
  process.exitCode = unavailable ? 70 : 65;
}
