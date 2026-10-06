// Install the fail-closed process guard before loading any experiment logic.
import './guard.mjs';
import { fileURLToPath } from 'node:url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || !['start', 'resume'].includes(process.argv[2])) throw new Error('phase_argument');
    const { qualify } = await import('./qualification.mjs');
    const e = await qualify({ phase: process.argv[2] });
    process.stdout.write(
      `${JSON.stringify({
        outcome: e.outcome,
        stop: e.stop ?? null,
        cleanup: e.cleanup,
        counts: e.accounting,
        transport: e.transportAccounting,
      })}\n`,
    );
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        outcome: 'LOCAL_GATE_STOP',
        kind: error.code === 'network_escape_denied' ? error.code : (error.kind ?? 'local_gate_failure'),
      })}\n`,
    );
    process.exitCode = 1;
  }
}
