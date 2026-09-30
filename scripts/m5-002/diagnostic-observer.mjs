import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

/** Operator-controlled, one-shot response loss AFTER the local service commits. No transport/merchant writes. */
export function createDiagnosticObserver({ directory, writeEvent = console.log }) {
  const flag = resolve(directory, 'discard-one-local-save-response');
  return (event) => {
    writeEvent(JSON.stringify({ event: 'm5-002', at: new Date().toISOString(), ...event }));
    if (event.kind === 'local_save' && event.result === 'saved' && existsSync(flag)) {
      if (readFileSync(flag, 'utf8') !== 'discard-one-committed-local-save\n')
        throw new Error('Diagnostic loss control invalid');
      unlinkSync(flag);
      writeEvent(
        JSON.stringify({ event: 'm5-002', kind: 'local_response_discarded', draftVersion: event.draftVersion }),
      );
      throw new Error('Diagnostic committed local response discarded');
    }
  };
}
