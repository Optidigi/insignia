import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// Policy and decode behavior of the inspector child itself. OS isolation is qualified in artwork-inspection.test.mts.
const child = fileURLToPath(new URL('../dist/artwork/child.js', import.meta.url));
const fixture = (name: string) => readFile(new URL(`./fixtures/artwork/${name}`, import.meta.url));
type Inspection = { mimeType: string; width: number; height: number; originalSha256: string; preview: Buffer };

async function inspect(bytes: Buffer): Promise<Inspection> {
  const run = spawn(process.execPath, [child], { stdio: ['pipe', 'pipe', 'pipe'] });
  const stdout: Buffer[] = [];
  run.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  run.stdin.end(bytes);
  const code = await new Promise<number | null>((resolve) => run.on('close', resolve));
  if (code !== 0) throw Object.assign(new Error(`inspection exited ${code}`), { exitCode: code });
  const result = JSON.parse(Buffer.concat(stdout).toString()) as Omit<Inspection, 'preview'> & { preview: string };
  return { ...result, preview: Buffer.from(result.preview, 'base64') };
}
const rejected = (bytes: Buffer, label: string) =>
  assert.rejects(inspect(bytes), { exitCode: 65 }, `${label} must be rejected by policy`);
/** The pixel limit is its own buyer-actionable outcome (#445): exit 66, never the generic policy exit 65. */
const tooLarge = (bytes: Buffer, label: string) =>
  assert.rejects(inspect(bytes), { exitCode: 66 }, `${label} must be rejected for its pixel size`);
const svg = (body: string, attributes = '') =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="40" height="20"${attributes}>${body}</svg>`,
  );

test('representative Illustrator, Inkscape and Figma exports are accepted byte-for-byte', async () => {
  for (const name of ['illustrator.svg', 'inkscape.svg', 'figma.svg']) {
    const bytes = await fixture(name);
    const result = await inspect(bytes);
    assert.equal(result.mimeType, 'image/svg+xml', name);
    assert.equal(result.originalSha256, createHash('sha256').update(bytes).digest('hex'), name);
  }
});

test('ordinary SVG authoring constructs are accepted', async () => {
  const cases = [
    svg(
      '<rect width="40" height="20"/>',
      ' version="1.1" baseProfile="full" class="logo" data-name="x" xml:space="preserve"',
    ),
    svg('<title>Fish &amp; Chips &#169; &#x2122;</title><rect width="40" height="20"/>'),
    svg('<text x="2" y="15" font-family="sans-serif" font-size="12">Hi <tspan font-weight="bold">there</tspan></text>'),
    svg(
      '<defs><pattern id="p" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1"/></pattern></defs><rect width="40" height="20" fill="url(#p)"/>',
    ),
    svg(
      '<style><![CDATA[ .a { fill: rgb(10, 20, 30) } #b, rect.c > circle { stroke: hsl(0, 50%, 50%) } ]]></style><rect class="a" width="4" height="4"/>',
    ),
    svg('<g aria-hidden="true" role="img" focusable="false"><path d="M0 0h4v4z" fill="currentColor"/></g>'),
  ];
  for (const bytes of cases) assert.equal((await inspect(bytes)).mimeType, 'image/svg+xml', bytes.toString());
});

test('large representative exports fit the retuned element and expansion budgets', async () => {
  const shapes = Array.from({ length: 10_000 }, (_, i) => `<rect x="${i % 40}" y="${i % 20}" width="1" height="1"/>`);
  const result = await inspect(svg(`<g>${shapes.join('')}</g>`));
  assert.equal(result.mimeType, 'image/svg+xml');
  await rejected(svg(Array.from({ length: 20_001 }, () => '<g/>').join('')), 'unbounded element count');
});

test('filter use is bounded per element so heavy filter graphs cannot hold a worker', async () => {
  const filter = '<defs><filter id="f"><feGaussianBlur stdDeviation="2"/></filter></defs>';
  const filtered = (count: number) =>
    svg(`${filter}${Array.from({ length: count }, () => '<rect width="40" height="20" filter="url(#f)"/>').join('')}`);
  assert.equal((await inspect(filtered(10))).mimeType, 'image/svg+xml');
  await rejected(filtered(1_001), 'excessive filtered elements');
  // Expansion through <use> counts every rendered application.
  await rejected(
    svg(`${filter}<rect id="r" width="40" height="20" filter="url(#f)"/>${'<use href="#r"/>'.repeat(1_000)}`),
    'filtered element repeated through use',
  );
});

test('embedded PNG/JPEG rasters are allowed only inside the decoded pixel budget', async () => {
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'blue' } })
    .jpeg()
    .toBuffer();
  const image = (mime: string, bytes: Buffer) =>
    svg(`<image width="20" height="20" xlink:href="data:${mime};base64,${bytes.toString('base64')}"/>`);
  assert.equal((await inspect(image('image/png', png))).mimeType, 'image/svg+xml');
  assert.equal((await inspect(image('image/jpeg', jpeg))).mimeType, 'image/svg+xml');
  const huge = Buffer.from(png);
  huge.writeUInt32BE(10_000, 16);
  huge.writeUInt32BE(10_000, 20);
  await rejected(image('image/png', huge), 'embedded raster over the pixel budget');
  await rejected(image('image/png', jpeg), 'embedded raster with mismatched type');
  await rejected(image('image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), 'embedded SVG');
  await rejected(image('text/html', Buffer.from('<script>alert(1)</script>')), 'embedded non-image data');
});

test('a valid image over the pixel limit is rejected for its size, not as an unsupported file (#445)', async () => {
  // Real 8000x8000 PNG: 64 megapixels, a few hundred KB. sharp refuses it while reading the header.
  const huge = await sharp({ create: { width: 8000, height: 8000, channels: 3, background: 'white' } })
    .png()
    .toBuffer();
  assert.ok(huge.length < 5 * 1024 * 1024, 'the fixture is under the 5 MiB file limit');
  await tooLarge(huge, '8000x8000 PNG');
  // Edge limit: within 40 megapixels (12001 x 1) but over 12000 on one side.
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  const wide = Buffer.from(png);
  wide.writeUInt32BE(12_001, 16);
  wide.writeUInt32BE(1, 20);
  await tooLarge(wide, '12001x1 PNG header');
  await tooLarge(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="12001" height="2"/>'), '12001px SVG');
});

test('other policy failures keep the generic rejection', async () => {
  await rejected(Buffer.from('not an image'), 'unrecognized bytes');
  const small = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  await rejected(small.subarray(0, small.length - 5), 'truncated PNG');
});

test('hostile SVG constructs remain rejected', async () => {
  const nested = Array.from(
    { length: 9 },
    (_, level) => `<g id="l${level + 1}">${Array.from({ length: 10 }, () => `<use href="#l${level}"/>`).join('')}</g>`,
  ).join('');
  const hostile: Array<[string, Buffer]> = [
    ['script', svg('<script>alert(1)</script>')],
    ['event handler', svg('<rect width="4" height="4" onload="alert(1)"/>')],
    ['event handler on root', svg('<rect width="4" height="4"/>', ' onload="alert(1)"')],
    ['external use', svg('<use href="https://example.com/a.svg#x"/>')],
    ['external image', svg('<image href="https://example.com/x.png" width="4" height="4"/>')],
    ['file image', svg('<image xlink:href="file:///etc/passwd" width="4" height="4"/>')],
    ['DTD', Buffer.from('<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>')],
    [
      'XXE entity',
      Buffer.from(
        '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><title>&x;</title></svg>',
      ),
    ],
    ['undeclared entity', svg('<title>&x;</title>')],
    [
      'processing instruction',
      Buffer.from('<?xml-stylesheet href="https://example.com/a.css"?><svg xmlns="http://www.w3.org/2000/svg"/>'),
    ],
    ['@import', svg('<style>@import url(https://example.com/a.css);</style>')],
    ['@font-face', svg("<style>@font-face { font-family: x; src: url('https://example.com/x.woff') }</style>")],
    ['external CSS url', svg('<style>.a { fill: url(https://example.com/a) }</style><rect class="a"/>')],
    ['external style url', svg('<rect width="4" height="4" style="fill:url(https://example.com/a)"/>')],
    ['external attribute url', svg('<rect width="4" height="4" fill="url(https://example.com/a)"/>')],
    ['unterminated url', svg('<rect width="4" height="4" style="fill:url(https://example.com/a"/>')],
    ['CSS escape', svg('<rect width="4" height="4" style="fill:u\\72l(https://example.com/a)"/>')],
    ['CSS expression', svg('<rect width="4" height="4" style="width:expression(alert(1))"/>')],
    ['foreignObject', svg('<foreignObject width="4" height="4"/>')],
    ['XHTML script', svg('<h:script xmlns:h="http://www.w3.org/1999/xhtml">alert(1)</h:script>')],
    ['XInclude', svg('<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="file:///etc/passwd"/>')],
    ['xml:base', svg('<use href="#a" xml:base="https://example.com/"/><rect id="a"/>')],
    ['animation', svg('<rect width="4" height="4"><animate attributeName="x" to="4"/></rect>')],
    ['set', svg('<a><set attributeName="href" to="javascript:alert(1)"/></a>')],
    ['feImage', svg('<filter id="f"><feImage href="https://example.com/x.png"/></filter>')],
    ['self reference', svg('<use href="#a" id="a"/>')],
    [
      'mutual reference',
      svg('<defs><g id="a"><use href="#b"/></g><g id="b"><use href="#a"/></g></defs><use href="#a"/>'),
    ],
    ['missing reference', svg('<rect width="4" height="4" fill="url(#missing)"/>')],
    ['billion laughs via use', svg(`<defs><rect id="l0" width="1" height="1"/>${nested}</defs><use href="#l9"/>`)],
    [
      'stylesheet recursion through a pattern',
      svg(
        '<style>.a{fill:url(#p)}</style><pattern id="p" width="2" height="2"><rect class="a" width="1" height="1"/></pattern><rect class="a"/>',
      ),
    ],
    ['missing namespace', Buffer.from('<svg width="4" height="4"><rect/></svg>')],
  ];
  for (const [label, bytes] of hostile) await rejected(bytes, label);
});

test('vector previews are rendered at preview scale rather than intrinsic size', async () => {
  const result = await inspect(await fixture('figma.svg'));
  assert.deepEqual([result.width, result.height], [24, 24]);
  const preview = await sharp(result.preview).metadata();
  assert.deepEqual([preview.width, preview.height], [512, 512]);
  const wide = await inspect(svg('<rect width="40" height="20" fill="red"/>'));
  const widePreview = await sharp(wide.preview).metadata();
  assert.deepEqual([widePreview.width, widePreview.height], [512, 256]);
});

/** A JPEG with an MPF APP2 index, a secondary image after the primary EOI and a vendor trailer. */
async function phoneJpeg() {
  const primary = await sharp({ create: { width: 64, height: 32, channels: 3, background: 'red' } })
    .jpeg()
    .toBuffer();
  const secondary = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'blue' } })
    .jpeg()
    .toBuffer();
  const mpfPayload = Buffer.concat([Buffer.from('MPF\0', 'binary'), Buffer.from('MM\0*\0\0\0\x08', 'binary')]);
  const app2 = Buffer.alloc(4);
  app2.writeUInt16BE(0xffe2, 0);
  app2.writeUInt16BE(mpfPayload.length + 2, 2);
  return Buffer.concat([
    primary.subarray(0, 2),
    app2,
    mpfPayload,
    primary.subarray(2),
    secondary,
    Buffer.from('SEFHtrailer'),
  ]);
}

test('phone JPEGs with MPF images and trailers keep the original and inspect the primary image', async () => {
  const bytes = await phoneJpeg();
  const result = await inspect(bytes);
  assert.equal(result.mimeType, 'image/jpeg');
  assert.deepEqual([result.width, result.height], [64, 32]);
  assert.equal(result.originalSha256, createHash('sha256').update(bytes).digest('hex'));
  const truncated = await sharp({ create: { width: 64, height: 32, channels: 3, background: 'red' } })
    .jpeg()
    .toBuffer();
  await rejected(truncated.subarray(0, truncated.length - 20), 'JPEG without its primary EOI');
});

test('PNG bytes after IEND are inert and kept in the original', async () => {
  const png = await sharp({ create: { width: 8, height: 4, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  const bytes = Buffer.concat([png, Buffer.from('trailing editor data')]);
  const result = await inspect(bytes);
  assert.deepEqual([result.mimeType, result.width, result.height], ['image/png', 8, 4]);
  assert.equal(result.originalSha256, createHash('sha256').update(bytes).digest('hex'));
});

test('EXIF orientation is applied to the preview and the reported dimensions', async () => {
  // Distinct quadrants make every rotation/mirror distinguishable.
  const quadrant = (color: string) =>
    sharp({ create: { width: 32, height: 16, channels: 3, background: color } })
      .png()
      .toBuffer();
  const base = await sharp({ create: { width: 64, height: 32, channels: 3, background: 'white' } })
    .composite([
      { input: await quadrant('red'), left: 0, top: 0 },
      { input: await quadrant('lime'), left: 32, top: 0 },
      { input: await quadrant('blue'), left: 0, top: 16 },
    ])
    .png()
    .toBuffer();
  for (let orientation = 1; orientation <= 8; orientation++) {
    const source = await sharp(base).jpeg({ quality: 100 }).withMetadata({ orientation }).toBuffer();
    const result = await inspect(source);
    const turned = orientation >= 5;
    assert.deepEqual([result.width, result.height], turned ? [32, 64] : [64, 32], `orientation ${orientation}`);
    const expected = await sharp(source).rotate().raw().toBuffer({ resolveWithObject: true });
    const actual = await sharp(result.preview).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([actual.info.width, actual.info.height], [expected.info.width, expected.info.height]);
    assert.ok(actual.data.equals(expected.data), `orientation ${orientation} preview pixels`);
  }
});
