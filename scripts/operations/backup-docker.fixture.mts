import assert from 'node:assert/strict';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { jsonFile, record, text } from './backup-files.mts';

const directory = text(process.argv[2]),
  command = text(process.argv[4]),
  row = record(jsonFile(join(directory, 'state.json')));
if (command === 'inspect') console.log(JSON.stringify([row]));
else if (command === 'stop' || command === 'start') {
  if (command === 'stop')
    assert.deepEqual(process.argv.slice(5, 7), ['--timeout', '-1'], 'forced Docker kill is forbidden');
  appendFileSync(join(directory, 'actions'), `${command}\n`);
  row.State = {
    Status: command === 'stop' ? 'exited' : 'running',
    ExitCode: existsSync(join(directory, 'unclean')) ? 137 : 0,
    OOMKilled: false,
  };
  writeFileSync(join(directory, 'state.json'), JSON.stringify(row), { mode: 0o600 });
  if (command === 'stop' && existsSync(join(directory, 'uncertain'))) process.exitCode = 7;
} else throw new Error('Unexpected synthetic Docker command');
