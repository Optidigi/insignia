/** Credentials-free source and actual Wasm qualification; no Shopify CLI. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWasm } from './build-wasm.mts';
import { semanticReplay } from './replay.mts';
import { ROOT, TARGETS } from './runtime.mts';
import { ensurePinnedTool } from './tools.mts';
export async function checkFunctions(): Promise<void> {
  for (const args of [
    ['fmt', '--all', '--', '--check'],
    ['clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings'],
    ['test', '--workspace', '--locked'],
  ])
    execFileSync('cargo', args, { cwd: ROOT, stdio: 'inherit' });
  for (const target of TARGETS) await buildWasm(target);
  const runner = await ensurePinnedTool(
    process.env.INSIGNIA_FUNCTION_RUNNER ?? join(ROOT, '.m1-artifacts/tools/function-runner-9.2.2'),
    'runner',
  );
  mkdirSync(join(ROOT, '.m1-artifacts'), { recursive: true });
  const report = semanticReplay(runner);
  writeFileSync(join(ROOT, '.m1-artifacts/replay.json'), `${JSON.stringify(report, null, 2)}\n`);
  for (const [target, evidence] of Object.entries(report)) console.log(JSON.stringify({ target, evidence }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkFunctions();
