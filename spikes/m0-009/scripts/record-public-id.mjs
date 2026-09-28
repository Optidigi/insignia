import { writeFileSync } from 'node:fs';

// Build metadata contains the public client ID only. The web launcher checks it
// against Shopify CLI's selected app before serving the standalone bundle.
writeFileSync(new URL('../dist/build-client-id', import.meta.url),
  `${process.env.PUBLIC_SHOPIFY_API_KEY}\n`, { mode: 0o600 });
