import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** The composition root supplies its actual artifact boundary; source/module depth is never authority. */
export async function readCustomerEmailPrivateJson(
  file: string,
  input: { artifactRoot: string; maxBytes: number },
): Promise<unknown> {
  const fail = (): never => {
    throw new Error('CUSTOMER_EMAIL_PRIVATE_PROFILE_UNAVAILABLE');
  };
  if (
    !isAbsolute(file) ||
    !isAbsolute(input.artifactRoot) ||
    !Number.isSafeInteger(input.maxBytes) ||
    input.maxBytes < 1 ||
    input.maxBytes > 16384
  )
    fail();
  const physicalFile = await realpath(file),
    artifactRoot = await realpath(input.artifactRoot);
  if (physicalFile !== resolve(file)) fail(); // Reject symlinks in parent directories as well as the final file.
  const roots = [artifactRoot];
  let directory = artifactRoot;
  for (let depth = 0; depth < 16; depth++) {
    try {
      if ((await lstat(join(directory, 'pnpm-workspace.yaml'))).isFile()) {
        roots.push(directory);
        break;
      }
    } catch {
      /* A portable artifact need not contain a source workspace. */
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  if (
    roots.some((root) => {
      const path = relative(root, physicalFile);
      return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
    })
  )
    fail();
  const handle = await open(physicalFile, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > input.maxBytes || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())
      fail();
    const buffer = Buffer.alloc(input.maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const read = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!read.bytesRead) break;
      offset += read.bytesRead;
    }
    if (!offset || offset > input.maxBytes) fail();
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset)));
  } finally {
    await handle.close();
  }
}

import type { CustomerArtworkEmailProfile } from './customer-artwork-email.js';

/** The reusable app credential is private custody, never the connected tooling token. */
export async function loadCustomerArtworkEmailProfile(
  file: string,
  expected: { appOrigin: string; accountId?: string; artifactRoot?: string },
): Promise<CustomerArtworkEmailProfile> {
  try {
    const value = await readCustomerEmailPrivateJson(file, {
      artifactRoot: expected.artifactRoot ?? process.cwd(),
      maxBytes: 4096,
    });
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('CUSTOMER_EMAIL_PROFILE_UNAVAILABLE');
    const data = value as Record<string, unknown>;
    const fields = ['version', 'accountId', 'apiToken', 'from', 'appOrigin', 'mode'];
    if (
      Object.keys(data).some((key) => !fields.includes(key)) ||
      data.version !== 'cloudflare-customer-artwork-email-v1' ||
      typeof data.accountId !== 'string' ||
      !/^[a-f0-9]{32}$/.test(data.accountId) ||
      typeof data.apiToken !== 'string' ||
      !data.apiToken ||
      /[\r\n\0]/.test(data.apiToken) ||
      data.from !== 'noreply@optidigi.nl' ||
      data.appOrigin !== new URL(expected.appOrigin).origin ||
      (data.mode !== 'development' && data.mode !== 'customer') ||
      (expected.accountId && data.accountId !== expected.accountId)
    )
      throw new Error('CUSTOMER_EMAIL_PROFILE_UNAVAILABLE');
    return {
      version: data.version,
      accountId: data.accountId,
      apiToken: data.apiToken,
      from: data.from,
      appOrigin: data.appOrigin,
      mode: data.mode,
    };
  } catch {
    throw new Error('CUSTOMER_EMAIL_PROFILE_UNAVAILABLE');
  }
}
