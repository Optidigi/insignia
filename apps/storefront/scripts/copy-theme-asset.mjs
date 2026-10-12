import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../dist/', import.meta.url));
const destination = fileURLToPath(new URL('../../../extensions/insignia-theme/assets/', import.meta.url));

/** Flat CDN asset names preserve relative ES imports. Retain prior hashed chunks
 * until release cleanup explicitly accounts for cached/in-flight entry modules. */
export async function copyThemeAssets({ from = source, to = destination } = {}) {
  const files = await readdir(from, { withFileTypes: true });
  if (
    !files.some((file) => file.name === 'insignia-storefront.js') ||
    !files.some((file) => file.name === 'insignia-element.js')
  )
    throw new Error('Theme build is missing its bootstrap or module entry');
  if (files.some((file) => !file.isFile() || !/^insignia-[A-Za-z0-9_.-]+\.(?:js|css)$/.test(file.name)))
    throw new Error('Theme build must contain only flat owned assets');
  await mkdir(to, { recursive: true });
  await Promise.all(files.map((file) => copyFile(resolve(from, file.name), resolve(to, file.name))));
  return files.map((file) => file.name);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await copyThemeAssets();
