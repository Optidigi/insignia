import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Pool } from 'pg';

export async function isolatedDatabase(prefix = 'insignia_http') {
  assert.match(prefix, /^[a-z][a-z0-9_]{1,30}$/);
  const endpoint = process.env.DATABASE_URL;
  if (!endpoint) throw new Error('An explicitly allocated test database endpoint is required');
  const admin = new Pool({ connectionString: endpoint });
  const database = `${prefix}_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(endpoint);
  url.pathname = `/${database}`;
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  let created = false;
  async function close() {
    try {
      if (created) await admin.query(`DROP DATABASE ${database}`);
    } finally {
      await admin.end();
    }
  }
  try {
    await admin.query(`CREATE DATABASE ${database}`);
    created = true;
    await promisify(execFile)(
      `${root}node_modules/.bin/dbmate`,
      ['--no-dump-schema', '--migrations-dir', `${root}packages/database/migrations`, 'up'],
      { cwd: root, env: { ...process.env, DATABASE_URL: url.href }, timeout: 30_000 },
    );
    return { connectionString: url.href, close };
  } catch (error) {
    await close();
    throw error;
  }
}
