import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const executable = process.argv[2];
assert(executable);
const result = spawnSync(executable, [...process.argv.slice(3), '--command', 'SELECT 1/0'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
