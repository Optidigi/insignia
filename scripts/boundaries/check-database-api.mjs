import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const databasePackage = resolve(root, 'packages/database');
const temp = mkdtempSync(resolve(databasePackage, '.database-api-probe-'));
try {
  const probes = new Map([
    ['raw constructor', ["import { createDatabase } from '@insignia/database';", 2305]],
    ['raw transaction helper', ["import { withTransaction } from '@insignia/database';", 2305]],
    ['raw table map', ["import type { Database } from '@insignia/database';", 2305]],
    ['raw executor', ["import type { DatabaseExecutor } from '@insignia/database';", 2305]],
    ['raw runner', ["import { PgTransactionRunner } from '@insignia/database';", 2305]],
    ['publication root export', ["import { stagePublicationIntent } from '@insignia/database';", 2305]],
    ['deep source', ["import { createDatabase } from '@insignia/database/src/client/database';", 2307]],
    ['deep built output', ["import { createDatabase } from '@insignia/database/dist/client/database.js';", 2307]],
    ['deep source root', ["import { createDurableCore } from '@insignia/database/src/index.js';", 2307]],
    ['deep built root', ["import { createDurableCore } from '@insignia/database/dist/index.js';", 2307]],
    [
      'public publication facade',
      [
        "import { createDurableCore } from '@insignia/database'; declare const core: ReturnType<typeof createDurableCore>; core.publication;",
        2339,
      ],
    ],
    [
      'callback insert',
      [
        "import { createDurableCore } from '@insignia/database'; declare const core: ReturnType<typeof createDurableCore>; core.transactions.run(async (tx) => { tx.insertInto('shops'); });",
        2339,
      ],
    ],
    [
      'callback select',
      [
        "import { createDurableCore } from '@insignia/database'; declare const core: ReturnType<typeof createDurableCore>; core.transactions.run(async (tx) => { tx.selectFrom('shops'); });",
        2339,
      ],
    ],
    [
      'callback update',
      [
        "import { createDurableCore } from '@insignia/database'; declare const core: ReturnType<typeof createDurableCore>; core.transactions.run(async (tx) => { tx.updateTable('shops'); });",
        2339,
      ],
    ],
  ]);
  for (const [name, [source, expectedCode]] of probes) {
    const file = resolve(temp, `${name.replaceAll(' ', '-')}.mts`);
    writeFileSync(file, source);
    const program = ts.createProgram([file], {
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
    });
    const diagnostics = ts.getPreEmitDiagnostics(program).filter((diagnostic) => diagnostic.file?.fileName === file);
    assert.deepEqual(
      diagnostics.map((diagnostic) => diagnostic.code),
      [expectedCode],
      `${name} must fail for precisely the intended API reason: ${diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('; ')}`,
    );
  }
  const deepImports = [
    '@insignia/database/src/client/database',
    '@insignia/database/dist/client/database.js',
    '@insignia/database/src/index.js',
    '@insignia/database/dist/index.js',
  ];
  for (const specifier of deepImports) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import '${specifier}'`], {
      cwd: databasePackage,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, `${specifier} must not be importable`);
    assert.match(result.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED/);
  }
  console.log(
    `Database public API rejects ${probes.size} compiler probes and ${deepImports.length} runtime deep imports.`,
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
