/** Walk the JPEG marker stream, including stuffed scan bytes. Do not accept ignored trailing payloads. */
export function assertSingleJpeg(bytes: Buffer): void {
  let offset = 2;
  let scan = false;
  while (offset < bytes.length) {
    if (scan) {
      while (offset < bytes.length && bytes[offset] !== 255) offset++;
    }
    if (bytes[offset++] !== 255) throw new Error('Invalid JPEG marker');
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === undefined) throw new Error('Truncated JPEG');
    if (scan && (marker === 0 || (marker >= 0xd0 && marker <= 0xd7))) continue;
    scan = false;
    if (marker === 0xd9) {
      if (offset !== bytes.length) throw new Error('JPEG trailing bytes');
      return;
    }
    if (marker === 0xd8 || marker === 0 || (marker >= 0xd0 && marker <= 0xd7)) throw new Error('Invalid JPEG frame');
    if (marker === 1) continue;
    if (offset + 2 > bytes.length) throw new Error('Truncated JPEG segment');
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw new Error('Truncated JPEG segment');
    if (marker === 0xe2 && bytes.toString('ascii', offset + 2, offset + 6) === 'MPF\0')
      throw new Error('Multiple JPEG frames forbidden');
    offset += length;
    if (marker === 0xda) scan = true;
  }
  throw new Error('Missing JPEG end');
}
