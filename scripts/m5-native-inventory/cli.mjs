import { constants, createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { collectInventory, sealAbandonedRun } from './collector.mjs';

const HELP =
  'Usage: node scripts/m5-native-inventory/cli.mjs --allocation PRIVATE_JSON --private-directory NEW_PRIVATE_DIR --token-fd INHERITED_FD [--test-endpoint LOOPBACK_URL]\n       node scripts/m5-native-inventory/cli.mjs --seal-abandoned PRIVATE_DIR\n';
const emit = (result) => {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.outcome === 'COLLECTION_COMPLETE_NATIVE_SAFETY_UNQUALIFIED' ? 0 : 1;
};
const invalid = {
  outcome: 'STOP_INPUT_NOT_ALLOCATED',
  requests: 0,
  pages: 0,
  records: 0,
  qualification: 'STOP_PRE_INSTALL_DESTINATION_EFFECTS_UNQUALIFIED',
};
async function privateManifest(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid() || info.size > 65536)
      throw new Error('PRIVATE_INPUT');
    const bytes = Buffer.alloc(65537);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 65536) throw new Error('PRIVATE_INPUT');
    return JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
  } finally {
    await file.close();
  }
}
async function tokenFromDescriptor(value) {
  if (!/^[0-9]+$/.test(value) || Number(value) < 3 || Number(value) > 255) throw new Error('PRIVATE_INPUT');
  const stream = createReadStream(null, { fd: Number(value), autoClose: true, highWaterMark: 4097 });
  const timer = setTimeout(() => stream.destroy(new Error('PRIVATE_INPUT')), 5000);
  let bytes = Buffer.alloc(0);
  try {
    for await (const chunk of stream) {
      if (bytes.length + chunk.length > 4097) throw new Error('PRIVATE_INPUT');
      bytes = Buffer.concat([bytes, chunk]);
    }
    const token = bytes.toString('utf8').replace(/\r?\n$/, '');
    if (!token || token.length > 4096 || /[\r\n\0]/.test(token)) throw new Error('PRIVATE_INPUT');
    return token;
  } finally {
    clearTimeout(timer);
    stream.destroy();
    bytes.fill(0);
  }
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 2 && args[0] === '--seal-abandoned') {
    emit(await sealAbandonedRun({ privateDirectory: args[1] }));
    return;
  }
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(HELP);
    return;
  }
  const options = {};
  const allowed = ['--allocation', '--private-directory', '--token-fd', '--test-endpoint'];
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || options[args[i]] !== undefined || !args[i + 1]) throw new Error('PRIVATE_INPUT');
    options[args[i]] = args[i + 1];
  }
  if (!options['--allocation'] || !options['--private-directory'] || !options['--token-fd'])
    throw new Error('PRIVATE_INPUT');
  const allocation = await privateManifest(options['--allocation']);
  const token = await tokenFromDescriptor(options['--token-fd']);
  emit(
    await collectInventory({
      allocation,
      token,
      privateDirectory: options['--private-directory'],
      testEndpoint: options['--test-endpoint'],
    }),
  );
}
try {
  await main();
} catch {
  emit(invalid);
}
