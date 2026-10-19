import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { text } from './backup-files.mts';
import { Docker, execute, type InspectorBoundary, type InspectorRow } from './backup-run.mts';

const directory = text(process.argv[2]),
  mode = text(process.argv[3]),
  config: unknown = JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8'));
class Inspector implements InspectorBoundary {
  private running = true;
  inspect(): InspectorRow {
    return {
      status: this.running ? 'running' : 'exited',
      invocation: 'old',
      configSha256: 'c'.repeat(64),
      jobs: false,
      socket: this.running,
    };
  }
  ready() {
    return true;
  }
  verifyArtifact() {}
  stop() {
    this.running = false;
    if (mode === 'inspector-uncertain-stop') throw new Error('unknown host service stop');
  }
  start() {
    throw new Error('unsettled inspector must not restart');
  }
}
try {
  await execute(
    config,
    new Docker(join(directory, 'docker')),
    () => {
      if (!process.argv.includes('--retry')) process.exit(91);
    },
    mode.startsWith('inspector-') ? new Inspector() : undefined,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Synthetic failure');
  process.exitCode = 1;
}
