import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

const destination = process.argv.at(-1);
assert(destination && process.argv.includes('--file'));
writeFileSync(destination, 'purchase records fixture', { mode: 0o600 });
