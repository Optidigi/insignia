import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { assertSingleJpeg } from './jpeg-policy.js';
import { assertSafeSvg } from './svg-policy.js';

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
    if (!ended || offset !== bytes.length) throw new Error('Invalid PNG termination');
  }
  if (jpeg) assertSingleJpeg(bytes);
  phase = 'decode';
  const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning', animated: true, sequentialRead: true });
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
  // Full decode precedes resize, so truncated or corrupt input is never accepted by metadata alone.
  const decoded = await image.raw().toBuffer({ resolveWithObject: true });
  const preview = await sharp(decoded.data, {
    raw: { width: decoded.info.width, height: decoded.info.height, channels: decoded.info.channels },
  })
    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  phase = 'output';
  process.stdout.write(
    JSON.stringify({
      version: 'm6-inspection-v1',
      mimeType: png ? 'image/png' : jpeg ? 'image/jpeg' : 'image/svg+xml',
      width: metadata.width,
      height: metadata.height,
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
