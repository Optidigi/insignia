import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { type TestFn, test } from 'node:test';
import { inspectArtwork } from '../dist/artwork/inspection.js';
import { runArtworkSandbox } from '../dist/artwork/sandbox.js';

let isolationUnavailable: string | undefined;
try {
  await runArtworkSandbox('isolation-probe.js', Buffer.from('{"mode":"probe"}'));
} catch {
  isolationUnavailable = 'NOT_RUN: qualified Linux bubblewrap/systemd user sandbox unavailable';
}
const isolatedTest = (name: string, fn: TestFn) => test(name, { skip: isolationUnavailable ?? false }, fn);
const svg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>',
);
isolatedTest('isolated inspector returns exact original identity and a raster preview', async () => {
  const result = await inspectArtwork(svg);
  assert.equal(result.originalSha256, createHash('sha256').update(svg).digest('hex'));
  assert.equal(result.mimeType, 'image/svg+xml');
  assert.equal(result.width, 40);
  assert.equal(result.height, 20);
  assert.deepEqual([...result.preview.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

isolatedTest('PNG and JPEG decode completely and preserve the source digest', async () => {
  const { default: sharp } = await import('sharp');
  for (const format of ['png', 'jpeg'] as const) {
    const source = await sharp({ create: { width: 32, height: 16, channels: 3, background: 'blue' } })
      [format]()
      .toBuffer();
    const result = await inspectArtwork(source);
    assert.equal(result.mimeType, `image/${format}`);
    assert.equal(result.originalSha256, createHash('sha256').update(source).digest('hex'));
    assert.equal((await sharp(result.preview).metadata()).width, 32);
    await assert.rejects(inspectArtwork(source.subarray(0, source.length - 5)));
  }
});
isolatedTest('unsupported magic, resource limits and hostile XML never become artwork', async () => {
  const cases = [
    Buffer.from('not an image'),
    Buffer.alloc(5 * 1024 * 1024 + 1),
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="12001" height="2"/>'),
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10000" height="10000"/>'),
  ];
  for (const body of [
    '<script>alert(1)</script>',
    '<image href="file:///etc/passwd"/>',
    '<image href="https://example.com/x.png"/>',
    '<foreignObject/>',
    '<style>path {fill:red}</style>',
    '<g onclick="alert(1)"/>',
    '<use href="#a" id="a"/>',
    '<defs><g id="a"><use href="#b"/></g><g id="b"><use href="#a"/></g></defs><use href="#a"/>',
    '<rect fill="url(https://example.com/a)"/>',
    '<text font-family="arial">x</text>',
  ])
    cases.push(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20">${body}</svg>`));
  cases.push(
    Buffer.from(
      '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>',
    ),
  );
  cases.push(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>'));
  for (const input of cases) await assert.rejects(inspectArtwork(input));
});
isolatedTest('bounded local fragment reuse remains valid', async () => {
  const source = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><defs><rect id="box" width="10" height="10" fill="blue"/></defs><use href="#box" x="2"/></svg>',
  );
  assert.equal((await inspectArtwork(source)).mimeType, 'image/svg+xml');
});
isolatedTest('OS isolation really denies host files, network and code writes', async () => {
  const { runArtworkSandbox } = await import('../dist/artwork/sandbox.js');
  const { createServer } = await import('node:net');
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const directory = await mkdtemp('/tmp/insignia-isolation-');
  const path = `${directory}/secret`;
  await writeFile(path, 'host-only');
  const server = createServer((socket) => socket.end('host'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert(address && typeof address === 'object');
    const raw: unknown = JSON.parse(
      (
        await runArtworkSandbox(
          'isolation-probe.js',
          Buffer.from(JSON.stringify({ mode: 'probe', port: address.port, path })),
        )
      ).toString(),
    );
    assert(raw && typeof raw === 'object');
    const result = raw;
    assert(
      'hostFileVisible' in result &&
        'network' in result &&
        'writable' in result &&
        'status' in result &&
        'limits' in result,
    );
    assert(typeof result.status === 'string' && typeof result.limits === 'string');
    assert.equal(result.hostFileVisible, false);
    assert.equal(result.network, false);
    assert.equal(result.writable, false);
    assert.match(result.status, /CapEff:\s+0000000000000000/);
    assert.match(result.limits, /Max cpu time\s+8\s+9/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
isolatedTest('cgroup memory and whole-unit wall/CPU limits kill misbehaving native children', async () => {
  const { runArtworkSandbox } = await import('../dist/artwork/sandbox.js');
  for (const mode of ['memory', 'cpu', 'hang']) {
    const start = Date.now();
    await assert.rejects(runArtworkSandbox('isolation-probe.js', Buffer.from(JSON.stringify({ mode }))), {
      code: 'REJECTED',
    });
    assert.ok(Date.now() - start < 12500, `${mode} did not terminate promptly`);
  }
});
isolatedTest('abort cancels isolated work and never returns success', async () => {
  const { runArtworkSandbox } = await import('../dist/artwork/sandbox.js');
  const controller = new AbortController();
  const promise = runArtworkSandbox('isolation-probe.js', Buffer.from('{"mode":"hang"}'), controller.signal);
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(promise, /aborted/);
  await assert.rejects(inspectArtwork(svg, { signal: controller.signal }), /aborted/);
});
isolatedTest('cancellation kills descendants, rather than only the launcher', async () => {
  const { runArtworkSandbox } = await import('../dist/artwork/sandbox.js');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const marker = `insignia-child-${crypto.randomUUID()}`;
  const controller = new AbortController();
  const work = runArtworkSandbox(
    'isolation-probe.js',
    Buffer.from(JSON.stringify({ mode: 'tree', marker })),
    controller.signal,
  );
  await new Promise((resolve) => setTimeout(resolve, 400));
  const before = await promisify(execFile)('ps', ['-eo', 'args']);
  assert.ok(before.stdout.includes(marker), 'the real descendant must have started');
  controller.abort();
  await assert.rejects(work, /aborted/);
  const after = await promisify(execFile)('ps', ['-eo', 'args']);
  assert.ok(!after.stdout.includes(marker), 'a descendant survived cgroup cancellation');
});
isolatedTest('animation and oversized raster metadata are rejected before promotion', async () => {
  const { default: sharp } = await import('sharp');
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  const crc32 = (data: Uint8Array) => {
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const bomb = Buffer.from(png);
  bomb.writeUInt32BE(10000, 16);
  bomb.writeUInt32BE(10000, 20);
  bomb.writeUInt32BE(crc32(bomb.subarray(12, 29)), 29);
  await assert.rejects(inspectArtwork(bomb));
  const actl = Buffer.alloc(20);
  actl.writeUInt32BE(8, 0);
  actl.write('acTL', 4);
  actl.writeUInt32BE(2, 8);
  actl.writeUInt32BE(crc32(actl.subarray(4, 16)), 16);
  await assert.rejects(inspectArtwork(Buffer.concat([png.subarray(0, 33), actl, png.subarray(33)])));
});
test('missing OS sandbox never silently executes the decoder unisolated', async () => {
  const previous = process.env.DBUS_SESSION_BUS_ADDRESS;
  process.env.DBUS_SESSION_BUS_ADDRESS = 'unix:path=/tmp/insignia-no-such-bus';
  let promise: ReturnType<typeof inspectArtwork>;
  try {
    promise = inspectArtwork(svg);
  } finally {
    if (previous === undefined) delete process.env.DBUS_SESSION_BUS_ADDRESS;
    else process.env.DBUS_SESSION_BUS_ADDRESS = previous;
  }
  await assert.rejects(promise, { code: 'UNAVAILABLE' });
});
isolatedTest('JPEG appended payloads and multiple-image containers are not accepted as a single frame', async () => {
  const { default: sharp } = await import('sharp');
  const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } })
    .jpeg()
    .toBuffer();
  await assert.rejects(inspectArtwork(Buffer.concat([jpeg, jpeg])));
});
isolatedTest('malformed artwork is terminal REJECTED while missing host capability is UNAVAILABLE', async () => {
  await assert.rejects(inspectArtwork(Buffer.from('invalid artwork')), { code: 'REJECTED' });
  await assert.rejects(inspectArtwork(Buffer.alloc(5 * 1024 * 1024 + 1)), { code: 'REJECTED' });
});
