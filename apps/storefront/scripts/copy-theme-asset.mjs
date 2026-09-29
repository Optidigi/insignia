import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../dist/insignia-storefront.js', import.meta.url));
const destination = fileURLToPath(
  new URL('../../../extensions/insignia-theme/assets/insignia-storefront.js', import.meta.url),
);
await mkdir(fileURLToPath(new URL('../../../extensions/insignia-theme/assets/', import.meta.url)), { recursive: true });
await copyFile(source, destination);
