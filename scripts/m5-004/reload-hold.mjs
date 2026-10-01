import { readFileSync } from 'node:fs';
import { digest } from './binding.mjs';

const [path, expected] = process.argv.slice(2);
const bytes = readFileSync(path);
if (bytes.length > 32 * 1024 || digest(bytes) !== expected) process.exit(1);
const hold = JSON.parse(bytes);
if (hold?.version !== 'm5-availability-hold-v1' || !hold.before || !hold.operationId) process.exit(1);
process.stdout.write(bytes);
