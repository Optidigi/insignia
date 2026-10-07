import './guard.mjs';
import { fileURLToPath } from 'node:url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== 'start') throw new Error('phase_argument');
    const { qualify } = await import('./qualification.mjs');
    const e = await qualify();
    process.stdout.write(
      `${JSON.stringify({
        outcome: e.outcome,
        classification: e.classification,
        cleanup: e.cleanup,
        counts: e.accounting,
        transport: e.transportAccounting,
      })}\n`,
    );
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ outcome: 'LOCAL_GATE_STOP', kind: error.code ?? error.kind ?? 'local_gate_failure' })}\n`,
    );
    process.exitCode = 1;
  }
}
