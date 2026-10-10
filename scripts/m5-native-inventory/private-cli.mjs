import { inspectPrivatePhase, runPrivateInventory } from './private-operator.mjs';

const args = process.argv.slice(2);
let result;
if (args.length === 2 && args[0] === '--gate') result = await runPrivateInventory({ gatePath: args[1] });
else if (args.length === 2 && args[0] === '--inspect-closed-phase') result = await inspectPrivatePhase(args[1]);
else result = { outcome: 'STOP_PRIVATE_INPUT', requests: 0, oauthAttempts: 0 };
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = result.outcome === 'COLLECTION_COMPLETE_NATIVE_SAFETY_UNQUALIFIED' ? 0 : 1;
